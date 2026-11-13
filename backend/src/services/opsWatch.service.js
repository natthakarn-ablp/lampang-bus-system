'use strict';

/**
 * opsWatch.service.js — backup + health watch that tells ADMINS IN THE APP
 * (owner request 2026-11-13). No LINE: the OA quota (~500/month) is reserved
 * for emergencies, and the existing technical LINE alert (health-smoke /
 * backup_status.py) is a separate, opt-in channel.
 *
 * Checks:
 *   backup — the backup-db.sh log (`[backup-db] <iso> start|done`, `ERROR`):
 *            FAILED  the latest run logged an ERROR, or started > 2 h ago and never logged `done`
 *            STALE   the latest completed run is older than OPS_BACKUP_MAX_AGE_HOURS (26)
 *            MISSING no log, or no run in it
 *   health — GET HEALTH_URL (default http://127.0.0.1:$PORT/health) must answer
 *            200 with success=true and database.connected=true within 5 s.
 *
 * Each problem becomes ONE audit_logs row per problem per Bangkok day
 * (entity_type 'ops_alert', entity_id = dedupe key) — shown on the admin bell
 * via GET /api/admin/pending-summary. No migration needed.
 */

const fs = require('fs');
const { logAudit } = require('../utils/audit');
const { bangkokDateStamp } = require('../utils/thaiTime');

const ENTITY = 'ops_alert';
const HOUR_MS = 3600 * 1000;

function settings(overrides = {}) {
  const n = parseInt(process.env.OPS_BACKUP_MAX_AGE_HOURS, 10);
  return {
    backupLog: process.env.BACKUP_LOG || '/home/schoolbus/backups/lampang-bus/backup.log',
    backupMaxAgeHours: Number.isFinite(n) && n > 0 ? n : 26,
    healthUrl: process.env.HEALTH_URL || `http://127.0.0.1:${process.env.PORT || 3000}/health`,
    ...overrides,
  };
}

const LINE_RE = /^\[backup-db\]\s+(\S+)\s+(start|done)\b/;

/** Pure: read backup-db.sh log text. */
function evaluateBackupLog(text, { now = new Date(), maxAgeHours = 26 } = {}) {
  if (text == null) return { status: 'MISSING', detail: 'no backup log' };
  const lines = String(text).split(/\r?\n/);
  let lastStart = null;
  let lastDone = null;
  let errorSinceStart = null;
  lines.forEach((line, idx) => {
    const m = LINE_RE.exec(line);
    if (m) {
      const t = new Date(m[1]);
      if (Number.isNaN(t.getTime())) return;
      if (m[2] === 'start') { lastStart = { t, idx }; errorSinceStart = null; } else lastDone = { t, idx };
      return;
    }
    if (lastStart && /\bERROR\b/.test(line)) errorSinceStart = line.trim().slice(0, 160);
  });
  if (!lastStart && !lastDone) return { status: 'MISSING', detail: 'no backup run in log' };

  const inFlight = lastStart && (!lastDone || lastStart.idx > lastDone.idx);
  if (inFlight) {
    if (errorSinceStart) return { status: 'FAILED', detail: errorSinceStart, startedAt: lastStart.t.toISOString() };
    if (now - lastStart.t > 2 * HOUR_MS) {
      return { status: 'FAILED', detail: 'run started but never finished', startedAt: lastStart.t.toISOString() };
    }
  }
  if (!lastDone) return { status: 'MISSING', detail: 'no completed backup yet' };
  const ageH = (now - lastDone.t) / HOUR_MS;
  if (ageH > maxAgeHours) {
    return { status: 'STALE', detail: `last backup ${Math.floor(ageH)} h ago`, lastDoneAt: lastDone.t.toISOString(), ageHours: Math.floor(ageH) };
  }
  return { status: 'OK', lastDoneAt: lastDone.t.toISOString(), ageHours: Math.floor(ageH) };
}

function readBackupLog(path) {
  try {
    const st = fs.statSync(path);
    // Only the tail matters; the log grows a few lines a day.
    const size = Math.min(st.size, 64 * 1024);
    const fd = fs.openSync(path, 'r');
    try {
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, st.size - size);
      return buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}

async function checkHealth(url, fetchImpl = global.fetch) {
  try {
    const timeout = global.AbortSignal?.timeout ? { signal: AbortSignal.timeout(5000) } : {};
    const res = await fetchImpl(url, timeout);
    if (!res.ok) return { status: 'FAILED', detail: `HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    if (!body || body.success !== true) return { status: 'FAILED', detail: 'unexpected body' };
    if (body.data && body.data.database && body.data.database.connected === false) {
      return { status: 'FAILED', detail: 'database not connected' };
    }
    return { status: 'OK' };
  } catch (e) {
    return { status: 'FAILED', detail: e.name === 'TimeoutError' ? 'timeout' : (e.code || e.message || 'error') };
  }
}

const MESSAGE = {
  backup: {
    FAILED: 'สำรองข้อมูลรอบล่าสุดล้มเหลว',
    STALE: 'ไม่มีการสำรองข้อมูลสำเร็จเกินเวลาที่กำหนด',
    MISSING: 'ไม่พบบันทึกการสำรองข้อมูล',
  },
  health: { FAILED: 'ระบบตรวจสุขภาพเซิร์ฟเวอร์ (/health) ไม่ผ่าน' },
};

/** One pass. Returns { checks, problems, created }. */
async function runOnce({
  db, dryRun = false, now = new Date(), overrides = {},
  readLog = readBackupLog, fetchImpl = global.fetch,
} = {}) {
  const cfg = settings(overrides);
  const backup = evaluateBackupLog(readLog(cfg.backupLog), { now, maxAgeHours: cfg.backupMaxAgeHours });
  const health = await checkHealth(cfg.healthUrl, fetchImpl);
  const checks = { backup, health };
  const day = bangkokDateStamp(now);
  const problems = [];
  if (backup.status !== 'OK') problems.push({ kind: 'backup', ...backup });
  if (health.status !== 'OK') problems.push({ kind: 'health', ...health });

  const created = [];
  for (const p of problems) {
    const key = `${p.kind}:${p.status}:${day}`;
    const [rows] = await db.query(
      'SELECT 1 FROM audit_logs WHERE entity_type = ? AND entity_id = ? LIMIT 1', [ENTITY, key]);
    if (rows.length) continue;
    const message = (MESSAGE[p.kind] && MESSAGE[p.kind][p.status]) || `${p.kind} ${p.status}`;
    if (!dryRun) {
      await logAudit({
        action: 'CREATE', entityType: ENTITY, entityId: key,
        newValue: { kind: p.kind, status: p.status, message, detail: p.detail || null, target_role: 'admin' },
        userAgent: 'ops-watch', conn: db, required: true,
      });
    }
    created.push({ key, kind: p.kind, status: p.status, message });
  }
  return { checks, problems, created };
}

/** Recent ops alerts for the admin bell. */
async function listRecentAlerts(db, { days = 3 } = {}) {
  const [rows] = await db.query(
    `SELECT id, entity_id, new_value, created_at FROM audit_logs
      WHERE entity_type = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY id DESC LIMIT 20`,
    [ENTITY, days]
  );
  return rows.map((r) => {
    let v = r.new_value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = {}; } }
    v = v || {};
    return { id: r.id, created_at: r.created_at, kind: v.kind, status: v.status, message: v.message, detail: v.detail || null };
  });
}

module.exports = { evaluateBackupLog, checkHealth, runOnce, listRecentAlerts, settings, ENTITY };
