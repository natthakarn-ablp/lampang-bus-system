'use strict';

// PERF-001 (architecture audit 2026-11-08) — LINE notification dispatcher that
// never holds a database transaction or row lock while talking to LINE.
//
//   1. claim   short transaction: pick due rows FOR UPDATE SKIP LOCKED, stamp a
//              per-run claim_token + lease (claimed_until), make sure the row
//              has a retry_key and first_attempt_at, commit.
//   2. send    outside any transaction, bounded concurrency, hard timeout,
//              same X-Line-Retry-Key / recipient / body on every attempt.
//   3. settle  UPDATE ... WHERE id = ? AND claim_token = ? — a worker whose
//              lease expired and was re-claimed by another run changes nothing.
//
// Outcome vocabulary (LINE "Retrying an API request" docs, read 2026-11-08):
//   2xx                         ACCEPTED — LINE accepted the request. LINE gives
//                               no delivery receipt, so this is NOT "received".
//   409 + x-line-accepted-request-id
//                               ACCEPTED — an earlier attempt with this key was
//                               accepted (e.g. the response was lost).
//   429, 5xx                    retry later with the same key.
//   timeout / network error     UNKNOWN outcome — retry later with the same key;
//                               LINE de-duplicates within 24 h.
//   other 4xx                   FAILED, never retried.
// A row whose key is older than KEY_SAFE_HOURS and still not accepted is never
// re-sent automatically (a new key could deliver a duplicate): it is parked as
// UNKNOWN with RETRY_KEY_EXPIRED_OUTCOME_UNKNOWN for a human to review.
//
// Requires migration 059. line.service.processUnsentNotifications() falls back
// to the legacy dispatcher when the columns are missing, so code can be
// deployed before the migration.

const crypto = require('crypto');
const { pool } = require('../config/database');
const env = require('../config/env');

const LINE_API_BASE = 'https://api.line.me';
const KEY_SAFE_HOURS = 23;          // LINE: key valid 24 h after the first request
const DEFAULTS = { leaseSeconds: 300, timeoutMs: 10000, concurrency: 4 };
const MAX_RETRIES = 3;

let schemaCache = { ready: null, checkedAt: 0 };

async function hasLeaseSchema(db = pool) {
  const now = Date.now();
  if (schemaCache.ready === true) return true;
  if (schemaCache.ready === false && now - schemaCache.checkedAt < 5 * 60 * 1000) return false;
  try {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS n FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'notifications'
          AND column_name IN ('retry_key','first_attempt_at','claim_token','claimed_until','attempt_count','line_request_id','delivery_state')`);
    schemaCache = { ready: Number(rows && rows[0] && rows[0].n) === 7, checkedAt: now };
  } catch {
    schemaCache = { ready: false, checkedAt: now };
  }
  return schemaCache.ready;
}

function resetSchemaCache() { schemaCache = { ready: null, checkedAt: 0 }; }

// ─── HTTP ───────────────────────────────────────────────────────────────────
// Direct fetch instead of the SDK: @line/bot-sdk 10.6.0's HTTPFetchClient
// passes no AbortSignal, so a hung LINE call could never time out.
async function pushWithRetryKey({ to, messages, retryKey, token, timeoutMs, baseUrl = LINE_API_BASE }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/v2/bot/message/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Line-Retry-Key': retryKey,
      },
      body: JSON.stringify({ to, messages }),
      signal: ctrl.signal,
    });
    // Drain the body so the socket is released; never log it (may echo text).
    await res.text().catch(() => '');
    return {
      status: res.status,
      requestId: res.headers.get('x-line-request-id'),
      acceptedRequestId: res.headers.get('x-line-accepted-request-id'),
    };
  } catch (err) {
    return { status: null, error: err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR' };
  } finally {
    clearTimeout(timer);
  }
}

function classify(r) {
  if (r.status == null) return { kind: 'retry', unknown: true, error: `${r.error}_OUTCOME_UNKNOWN` };
  if (r.status >= 200 && r.status < 300) return { kind: 'accepted', requestId: r.requestId || null };
  if (r.status === 409 && r.acceptedRequestId) return { kind: 'accepted', requestId: r.acceptedRequestId };
  if (r.status === 429 || r.status >= 500) return { kind: 'retry', unknown: r.status >= 500, error: `HTTP_${r.status}` };
  return { kind: 'failed', error: `HTTP_${r.status}` };
}

// ─── claim / settle ─────────────────────────────────────────────────────────
async function claimBatch({ limit, maxAgeMinutes, types, leaseSeconds, db = pool }) {
  const conn = await db.getConnection();
  const token = crypto.randomUUID();
  try {
    await conn.beginTransaction();
    const where = ['sent = FALSE', 'retry_count < ?', '(claimed_until IS NULL OR claimed_until < NOW())'];
    const params = [MAX_RETRIES];
    if (maxAgeMinutes != null) { where.push('created_at >= DATE_SUB(NOW(), INTERVAL ? MINUTE)'); params.push(maxAgeMinutes); }
    if (Array.isArray(types) && types.length) {
      where.push(`notification_type IN (${types.map(() => '?').join(',')})`);
      params.push(...types);
    }
    params.push(limit);
    const [picked] = await conn.query(
      `SELECT id FROM notifications WHERE ${where.join(' AND ')}
        ORDER BY created_at ASC LIMIT ? FOR UPDATE SKIP LOCKED`, params);
    if (!picked.length) { await conn.commit(); return { token, rows: [] }; }
    const ids = picked.map(r => r.id);
    await conn.query(
      `UPDATE notifications
          SET claim_token = ?, claimed_until = DATE_ADD(NOW(), INTERVAL ? SECOND),
              retry_key = COALESCE(retry_key, UUID()),
              first_attempt_at = COALESCE(first_attempt_at, NOW()),
              attempt_count = attempt_count + 1
        WHERE id IN (${ids.map(() => '?').join(',')})`, [token, leaseSeconds, ...ids]);
    const [rows] = await conn.query(
      `SELECT id, target_line_user_id, notification_type, student_id, message_json, retry_key,
              attempt_count, TIMESTAMPDIFF(MINUTE, first_attempt_at, NOW()) AS key_age_min
         FROM notifications WHERE claim_token = ? ORDER BY created_at ASC`, [token]);
    await conn.commit();
    return { token, rows };
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

const SETTLE = {
  accepted: `UPDATE notifications SET sent = TRUE, sent_at = NOW(), delivery_state = 'ACCEPTED',
               line_request_id = ?, error_message = NULL, claim_token = NULL, claimed_until = NULL
             WHERE id = ? AND claim_token = ?`,
  retry: `UPDATE notifications SET retry_count = retry_count + 1, error_message = ?,
            delivery_state = ?, claim_token = NULL, claimed_until = NULL
          WHERE id = ? AND claim_token = ?`,
  terminal: `UPDATE notifications SET retry_count = ${MAX_RETRIES}, error_message = ?, delivery_state = ?,
               claim_token = NULL, claimed_until = NULL
             WHERE id = ? AND claim_token = ?`,
  dryRun: `UPDATE notifications SET sent = TRUE, sent_at = NOW(), delivery_state = 'SKIPPED',
             error_message = 'DRY_RUN_NO_TOKEN', claim_token = NULL, claimed_until = NULL
           WHERE id = ? AND claim_token = ?`,
};

async function settle(db, sql, params) {
  const [r] = await db.query(sql, params);
  return Number(r && r.affectedRows) === 1;
}

async function runPool(items, concurrency, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  });
  await Promise.all(workers);
}

async function dispatchBatch({
  limit = 50, maxAgeMinutes = 180, types = null, db = pool,
  leaseSeconds = DEFAULTS.leaseSeconds, timeoutMs = DEFAULTS.timeoutMs,
  concurrency = DEFAULTS.concurrency, baseUrl, push = pushWithRetryKey,
  token = env.line && env.line.channelAccessToken,
} = {}) {
  const line = require('./line.service');
  const { token: claim, rows } = await claimBatch({ limit, maxAgeMinutes, types, leaseSeconds, db });
  const out = { processed: rows.length, sent: 0, failed: 0, skipped: 0, retry: 0, unknown: 0, lost: 0 };
  const settled = async (sql, params, bucket) => {
    if (await settle(db, sql, params)) out[bucket]++; else out.lost++;
  };

  await runPool(rows, concurrency, async (n) => {
    if (Number(n.attempt_count) > 1 && Number(n.key_age_min) >= KEY_SAFE_HOURS * 60) {
      return settled(SETTLE.terminal, ['RETRY_KEY_EXPIRED_OUTCOME_UNKNOWN', 'UNKNOWN', n.id, claim], 'unknown');
    }
    if (n.student_id != null && !(await line.isStillLinkedRecipient(db, n.target_line_user_id, n.student_id))) {
      return settled(SETTLE.terminal, ['RECIPIENT_NO_LONGER_LINKED', 'SKIPPED', n.id, claim], 'skipped');
    }
    const data = typeof n.message_json === 'string' ? JSON.parse(n.message_json) : n.message_json;
    const text = line.buildNotificationText(n.notification_type, data);
    if (!token) {
      console.log('[LINE DRY-RUN] notification', n.id);
      return settled(SETTLE.dryRun, [n.id, claim], 'sent');
    }
    const r = await push({
      to: n.target_line_user_id, messages: [{ type: 'text', text }],
      retryKey: n.retry_key, token, timeoutMs, baseUrl,
    });
    const c = classify(r);
    if (c.kind === 'accepted') return settled(SETTLE.accepted, [c.requestId, n.id, claim], 'sent');
    if (c.kind === 'failed') return settled(SETTLE.terminal, [c.error, 'FAILED', n.id, claim], 'failed');
    return settled(SETTLE.retry, [c.error, c.unknown ? 'UNKNOWN' : 'PENDING', n.id, claim], c.unknown ? 'unknown' : 'retry');
  });
  return out;
}

module.exports = {
  dispatchBatch, claimBatch, classify, pushWithRetryKey, hasLeaseSchema, resetSchemaCache,
  KEY_SAFE_HOURS, MAX_RETRIES,
};
