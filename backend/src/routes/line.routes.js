'use strict';

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const env = require('../config/env');
const lineSvc = require('../services/line.service');
const tpl = require('../services/lineFlexTemplates.service');
const bindGuard = require('../services/lineBindGuard');

/**
 * Verify LINE webhook signature (HMAC-SHA256, base64).
 *
 * Fail-CLOSED in production: if no channel secret is configured the request is
 * rejected. (In production this branch is unreachable because env.js refuses to
 * boot without LINE_CHANNEL_SECRET — kept here as defense-in-depth.) Outside
 * production we accept when no secret is set, to keep local dev / dry-run
 * frictionless. Comparison is constant-time to avoid signature timing leaks.
 */
function verifySignature(body, signature) {
  const secret = env.line.channelSecret;
  if (!secret) {
    return env.app.nodeEnv !== 'production';
  }
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  let provided;
  try {
    provided = Buffer.from(String(signature || ''), 'base64');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

/**
 * Constant-time string compare for API keys (audit 2026-06-18, line-integration).
 * Avoids the timing side-channel of `!==`.
 */
function safeKeyEqual(a, b) {
  const ba = Buffer.from(String(a == null ? '' : a));
  const bb = Buffer.from(String(b == null ? '' : b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// In-memory dedup of recently seen LINE webhookEventIds (audit 2026-06-18,
// line-integration): LINE retries deliveries, so without dedup a single event can
// be processed multiple times. Bounded ring to cap memory; single-instance only.
const SEEN_EVENTS = new Map(); // id -> timestamp
const SEEN_EVENTS_MAX = 5000;
function alreadyProcessed(eventId) {
  if (!eventId) return false;
  if (SEEN_EVENTS.has(eventId)) return true;
  SEEN_EVENTS.set(eventId, Date.now());
  if (SEEN_EVENTS.size > SEEN_EVENTS_MAX) {
    // drop the oldest ~10%
    const drop = Math.floor(SEEN_EVENTS_MAX * 0.1);
    let i = 0;
    for (const k of SEEN_EVENTS.keys()) { SEEN_EVENTS.delete(k); if (++i >= drop) break; }
  }
  return false;
}

// LINE webhook — uses express.raw to get Buffer for signature verification
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let rawBody;
  if (Buffer.isBuffer(req.body)) {
    rawBody = req.body;
  } else if (typeof req.body === 'string') {
    rawBody = Buffer.from(req.body);
  } else {
    // Fallback: collect raw chunks manually if body wasn't parsed
    rawBody = Buffer.from(JSON.stringify(req.body || {}));
  }

  const signature = req.headers['x-line-signature'] || '';
  if (!verifySignature(rawBody, signature)) {
    console.warn('[LINE] Invalid signature');
    return res.status(403).json({ error: 'Invalid signature' });
  }

  // LINE expects 200 immediately
  res.status(200).json({ status: 'ok' });

  // Process events asynchronously
  try {
    const body = JSON.parse(rawBody.toString());
    const events = body.events || [];
    for (const event of events) {
      // Skip a redelivered event we've already handled (replay/retry dedup).
      if (alreadyProcessed(event.webhookEventId)) continue;
      await handleEvent(event).catch(err =>
        console.error('[LINE] Event error:', err.message)
      );
    }
  } catch (err) {
    console.error('[LINE] Webhook parse error:', err.message);
  }
});

// ─── Keyword matcher (Phase 10.3E-HF4.2) ─────────────────────────────────────
// Map case-insensitive, whitespace-trimmed user input to a canonical intent.
// Rich-menu labels and natural variants both resolve to the same intent.
const COMMAND_ALIASES = {
  cancel:    ['ยกเลิก', 'cancel'],
  bind:      ['ผูกบัญชี', 'ลงทะเบียน', 'link', 'ผูก'],
  unbind:    ['ยกเลิกผูกบัญชี', 'unlink', 'ยกเลิกบัญชี', 'ยกเลิกผูก'],
  rebind:    ['เปลี่ยนบัญชี', 'rebind', 'เปลี่ยนผู้ใช้', 'เปลี่ยนผู้ปกครอง'],
  status:    ['สถานะ', 'status'],
  children:  ['ข้อมูลบุตร', 'children', 'ลูก', 'ข้อมูลลูก'],
  help:      ['ช่วยเหลือ', 'help', 'เมนู', 'menu'],
  confirmUnlink: ['ยืนยันยกเลิก'],
  confirmRebind: ['ยืนยันเปลี่ยนบัญชี'],
};
function matchCommand(input) {
  const lower = input.trim().toLowerCase();
  for (const [intent, aliases] of Object.entries(COMMAND_ALIASES)) {
    if (aliases.some((a) => a.toLowerCase() === lower)) return intent;
  }
  return null;
}

// Phase 10.3E-UX2.1 — Top-level commands that MUST override any pending chat
// state. Without this, typing "ผูกบัญชี" while stuck in await_phone made the
// state machine try to parse "ผูกบัญชี" as a phone number and reply
// "เบอร์โทรไม่ถูกต้อง".
//
// `cancel` is intentionally absent — its handler reads state BEFORE clearing
// to render different copy ("had-pending" vs "idle"), so it manages its own
// clear. Confirmation intents (confirmUnlink / confirmRebind) are also absent
// — they only make sense mid-flow and must NOT bypass the state machine.
const TOP_LEVEL_INTENTS = new Set([
  'bind', 'unbind', 'rebind', 'status', 'children', 'help',
]);

/**
 * Handle a single LINE event.
 */
async function handleEvent(event) {
  const lineUserId = event.source?.userId;
  if (!lineUserId) return;

  if (event.type === 'follow') {
    await lineSvc.upsertLineUser(lineUserId, null);
    await lineSvc.logMessage(lineUserId, 'system', 'follow', 'ok', null);
    // Welcome with help card — same content as /help, since this is the
    // very first impression we get.
    await lineSvc.pushParentFlex(lineUserId, {
      flex:         tpl.buildParentHelpCard(false),
      fallbackText: tpl.fallbackHelp(false),
      logPrefix:    '[LINE_PARENT_WELCOME_FLEX]',
    });
    return;
  }

  if (event.type === 'unfollow') {
    await lineSvc.removeLineUser(lineUserId);
    await lineSvc.logMessage(lineUserId, 'system', 'unfollow', 'ok', null);
    return;
  }

  if (event.type === 'message' && event.message?.type === 'text') {
    const text = event.message.text.trim();
    await lineSvc.logMessage(lineUserId, 'user', text, 'received', null);
    await handleTextMessage(lineUserId, text);
    return;
  }

  // Phase 10.3E-UX2 — tap-driven actions (Flex postback buttons)
  if (event.type === 'postback') {
    const data = event.postback?.data || '';
    // Log a truncated view of the data (never user-controlled secrets — these
    // are server-issued query strings) for audit.
    await lineSvc.logMessage(lineUserId, 'user', `postback:${data.slice(0, 60)}`, 'received', null);
    await handlePostback(lineUserId, data);
    return;
  }
}

/**
 * Postback dispatcher. Parses data as a URL-encoded query string and routes
 * by `action` key. Keep this small — any heavy logic should live in helpers
 * so it can be unit-tested independently. Never throws (handleEvent already
 * catches at the outer scope, but defensive try/catch within each branch).
 */
async function handlePostback(lineUserId, data) {
  const params = new URLSearchParams(data || '');
  const action = params.get('action');

  if (action === 'unlink_confirm') {
    // Same effect as the legacy chat "ยืนยันยกเลิก" branch — clear pending
    // chat state, run the unlink, push the appropriate success/error Flex.
    lineSvc.clearLinkState(lineUserId);
    const result = await lineSvc.unlinkAccount(lineUserId);
    if (result.success) {
      await lineSvc.logMessage(lineUserId, 'system', 'unlink_success_postback', 'ok', `parent_id=${result.unlinkedParentId}`);
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentUnbindSuccessCard(),
        fallbackText: tpl.fallbackUnbindSuccess(),
        logPrefix:    '[LINE_PARENT_UNBIND_FLEX]',
      });
    } else {
      // Idempotent: if the user double-taps Confirm or the account was
      // already unlinked elsewhere, show the friendly "not bound" card
      // rather than a hard error.
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentNotBoundCard(),
        fallbackText: tpl.fallbackNotBound(),
        logPrefix:    '[LINE_PARENT_UNBIND_FLEX]',
      });
    }
    return;
  }

  if (action === 'unlink_cancel') {
    const state = lineSvc.getLinkState(lineUserId);
    if (state) lineSvc.clearLinkState(lineUserId);
    await lineSvc.pushParentFlex(lineUserId, {
      flex:         tpl.buildParentCancelCard(Boolean(state)),
      fallbackText: tpl.fallbackCancel(Boolean(state)),
      logPrefix:    '[LINE_PARENT_UNBIND_FLEX]',
    });
    return;
  }

  // Unknown postback — likely a stale button from an old Flex carousel or
  // a forged payload. Don't push anything to the user (no chat spam); just
  // log for audit. Postback data is server-issued, so unknown actions are
  // safe to silently ignore.
  console.warn('[LINE_POSTBACK] unknown action', { action: action || '(none)' });
}

/**
 * Handle text message commands.
 *
 * State machine steps:
 *   (none)            → idle, process commands
 *   await_phone       → waiting for phone number (bind flow)
 *   await_student_id  → waiting for student ID (bind flow)
 *   confirm_unlink    → waiting for "ยืนยันยกเลิก"
 *   confirm_rebind    → waiting for "ยืนยันเปลี่ยนบัญชี"
 */
async function handleTextMessage(lineUserId, text) {
  const cmd = text.trim();
  const intent = matchCommand(cmd);

  // Top-level command guard: any of these intents wins over a stale chat
  // state, so the user can always exit a half-finished flow by typing the
  // canonical keyword (or tapping the rich-menu equivalent). `cancel` is
  // handled separately (see TOP_LEVEL_INTENTS comment).
  if (intent && TOP_LEVEL_INTENTS.has(intent)) {
    lineSvc.clearLinkState(lineUserId);
  }

  // ── "ยกเลิก" resets any pending state ──
  if (intent === 'cancel') {
    const state = lineSvc.getLinkState(lineUserId);
    if (state) lineSvc.clearLinkState(lineUserId);
    await lineSvc.pushParentFlex(lineUserId, {
      flex:         tpl.buildParentCancelCard(Boolean(state)),
      fallbackText: tpl.fallbackCancel(Boolean(state)),
      logPrefix:    '[LINE_PARENT_CANCEL_FLEX]',
    });
    return;
  }

  // ── State machine: process pending states first ──
  const state = lineSvc.getLinkState(lineUserId);

  if (state?.step === 'await_phone') {
    const phone = cmd.replace(/-/g, '').trim();
    if (!/^\d{9,10}$/.test(phone)) {
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentInvalidPhoneCard(),
        fallbackText: tpl.fallbackInvalidPhone(),
        logPrefix:    '[LINE_PARENT_BIND_FLEX]',
      });
      return;
    }
    const normalized = phone.length === 9 && (phone[0] === '8' || phone[0] === '9') ? '0' + phone : phone;
    lineSvc.setLinkState(lineUserId, { step: 'await_student_id', phone: normalized });
    await lineSvc.pushParentFlex(lineUserId, {
      flex:         tpl.buildParentRequestStudentCard(),
      fallbackText: tpl.fallbackRequestStudent(),
      logPrefix:    '[LINE_PARENT_BIND_FLEX]',
    });
    return;
  }

  if (state?.step === 'await_student_id') {
    // Phase 10.13C-4A — accept the VISIBLE รหัสนักเรียน (student_code), which may be
    // non-numeric, as the credential (was parseInt-only).
    const credential = String(cmd || '').trim();
    if (!credential || credential.length > 50) {
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentInvalidStudentCard(),
        fallbackText: tpl.fallbackInvalidStudent(),
        logPrefix:    '[LINE_PARENT_BIND_FLEX]',
      });
      return;
    }

    // Same credential lockout as the LIFF bind endpoints (per phone / student /
    // pair / sub). The chat path is another guessing surface for the same pair.
    const guardKeys = bindGuard.keysFor({ phone: state.phone, studentKey: credential, sub: lineUserId });
    const lock = bindGuard.checkLock(guardKeys);
    if (lock.locked) {
      await lineSvc.auditBind({ sub: lineUserId, phone: state.phone, studentCode: credential, action: 'LINE_BIND_LOCKED', reason: lock.reason });
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentBindErrorCard('พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง'),
        fallbackText: tpl.fallbackBindError('พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง'),
        logPrefix:    '[LINE_PARENT_BIND_FLEX]',
      });
      return;
    }

    const result = await lineSvc.tryLinkByPhoneAndStudentId(lineUserId, state.phone, credential);
    lineSvc.clearLinkState(lineUserId);
    if (result.success) {
      bindGuard.noteSuccess(guardKeys);
      await lineSvc.auditBind({ sub: lineUserId, phone: state.phone, studentCode: credential, action: 'LINE_BIND_SUCCESS', reason: 'SUCCESS' });
      await lineSvc.logMessage(lineUserId, 'system', 'bind_success', 'ok', `parent_id=${result.parentId}`);
      const children = await lineSvc.getLinkedChildren(lineUserId);
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentBindSuccessCard(children),
        fallbackText: tpl.fallbackBindSuccess(children),
        logPrefix:    '[LINE_PARENT_BIND_FLEX]',
      });
    } else {
      const isConflict = !!result.code; // PHONE_BOUND_TO_OTHER / USER_BOUND_TO_OTHER_PHONE
      if (!isConflict) bindGuard.noteFailure(guardKeys);
      await lineSvc.auditBind({
        sub: lineUserId, phone: state.phone, studentCode: credential,
        action: isConflict ? 'LINE_BIND_DUPLICATE_OR_ALREADY_BOUND' : 'LINE_BIND_CONFIRM_FAILED',
        reason: isConflict ? 'ALREADY_BOUND' : 'CREDENTIAL_MISMATCH',
      });
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentBindErrorCard(result.message),
        fallbackText: tpl.fallbackBindError(result.message),
        logPrefix:    '[LINE_PARENT_BIND_FLEX]',
      });
    }
    return;
  }

  if (state?.step === 'confirm_unlink') {
    if (intent === 'confirmUnlink') {
      lineSvc.clearLinkState(lineUserId);
      const result = await lineSvc.unlinkAccount(lineUserId);
      if (result.success) {
        await lineSvc.logMessage(lineUserId, 'system', 'unlink_success', 'ok', `parent_id=${result.unlinkedParentId}`);
        await lineSvc.pushParentFlex(lineUserId, {
          flex:         tpl.buildParentUnbindSuccessCard(),
          fallbackText: tpl.fallbackUnbindSuccess(),
          logPrefix:    '[LINE_PARENT_UNBIND_FLEX]',
        });
      } else {
        await lineSvc.pushParentFlex(lineUserId, {
          flex:         tpl.buildParentBindErrorCard(result.message || 'ระบบไม่สามารถยกเลิกได้'),
          fallbackText: tpl.fallbackBindError(result.message || 'ระบบไม่สามารถยกเลิกได้'),
          logPrefix:    '[LINE_PARENT_UNBIND_FLEX]',
        });
      }
    } else {
      lineSvc.clearLinkState(lineUserId);
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentCancelCard(true),
        fallbackText: tpl.fallbackCancel(true),
        logPrefix:    '[LINE_PARENT_UNBIND_FLEX]',
      });
    }
    return;
  }

  if (state?.step === 'confirm_rebind') {
    if (intent === 'confirmRebind') {
      const unlinkResult = await lineSvc.unlinkAccount(lineUserId);
      if (unlinkResult.success) {
        await lineSvc.logMessage(lineUserId, 'system', 'rebind_unlink', 'ok', `old_parent_id=${unlinkResult.unlinkedParentId}`);
        lineSvc.setLinkState(lineUserId, { step: 'await_phone' });
        await lineSvc.pushParentFlex(lineUserId, {
          flex:         tpl.buildParentRebindContinueCard(),
          fallbackText: tpl.fallbackRebindContinue(),
          logPrefix:    '[LINE_PARENT_REBIND_FLEX]',
        });
      } else {
        lineSvc.clearLinkState(lineUserId);
        await lineSvc.pushParentFlex(lineUserId, {
          flex:         tpl.buildParentBindErrorCard('ไม่สามารถยกเลิกการผูกบัญชีเดิมได้ กรุณาลองใหม่'),
          fallbackText: tpl.fallbackBindError('ไม่สามารถยกเลิกการผูกบัญชีเดิมได้ กรุณาลองใหม่'),
          logPrefix:    '[LINE_PARENT_REBIND_FLEX]',
        });
      }
    } else {
      lineSvc.clearLinkState(lineUserId);
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentCancelCard(true),
        fallbackText: tpl.fallbackCancel(true),
        logPrefix:    '[LINE_PARENT_REBIND_FLEX]',
      });
    }
    return;
  }

  // ── Commands (no pending state) ──

  if (intent === 'bind') {
    const linked = await lineSvc.getLinkedParentId(lineUserId);
    if (linked) {
      const summary = await lineSvc.getLinkedParentSummary(lineUserId);
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentBindAlreadyCard(summary),
        fallbackText: tpl.fallbackBindAlready(summary),
        logPrefix:    '[LINE_PARENT_BIND_FLEX]',
      });
      return;
    }
    lineSvc.setLinkState(lineUserId, { step: 'await_phone' });
    await lineSvc.pushParentFlex(lineUserId, {
      flex:         tpl.buildParentRequestPhoneCard({ liffId: env.line.liffId }),
      fallbackText: tpl.fallbackRequestPhone(),
      logPrefix:    '[LINE_PARENT_BIND_FLEX]',
    });
    return;
  }

  if (intent === 'unbind') {
    const linked = await lineSvc.getLinkedParentId(lineUserId);
    if (!linked) {
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentNotBoundCard(),
        fallbackText: tpl.fallbackNotBound(),
        logPrefix:    '[LINE_PARENT_UNBIND_FLEX]',
      });
      return;
    }
    const summary = await lineSvc.getLinkedParentSummary(lineUserId);
    lineSvc.setLinkState(lineUserId, { step: 'confirm_unlink' });
    await lineSvc.pushParentFlex(lineUserId, {
      flex:         tpl.buildParentConfirmUnbindCard(summary),
      fallbackText: tpl.fallbackConfirmUnbind(summary),
      logPrefix:    '[LINE_PARENT_UNBIND_FLEX]',
    });
    return;
  }

  if (intent === 'rebind') {
    const linked = await lineSvc.getLinkedParentId(lineUserId);
    if (!linked) {
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentNotBoundCard(),
        fallbackText: tpl.fallbackNotBound(),
        logPrefix:    '[LINE_PARENT_REBIND_FLEX]',
      });
      return;
    }
    const summary = await lineSvc.getLinkedParentSummary(lineUserId);
    lineSvc.setLinkState(lineUserId, { step: 'confirm_rebind' });
    await lineSvc.pushParentFlex(lineUserId, {
      flex:         tpl.buildParentConfirmRebindCard(summary),
      fallbackText: tpl.fallbackConfirmRebind(summary),
      logPrefix:    '[LINE_PARENT_REBIND_FLEX]',
    });
    return;
  }

  if (intent === 'status') {
    const children = await lineSvc.getLinkedChildren(lineUserId);
    if (children.length === 0) {
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentNotBoundCard(),
        fallbackText: tpl.fallbackNotBound(),
        logPrefix:    '[LINE_PARENT_STATUS_FLEX]',
      });
      return;
    }
    // Phase 10.3E-HF4 — Flex card with text fallback baked into the helper.
    const childrenWithStatus = [];
    for (const child of children) {
      const status = await lineSvc.getChildStatusToday(child.id);
      childrenWithStatus.push({ child, status });
    }
    await lineSvc.pushParentStatusFlex(lineUserId, childrenWithStatus);
    return;
  }

  if (intent === 'children') {
    const children = await lineSvc.getLinkedChildren(lineUserId);
    if (children.length === 0) {
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentNotBoundCard(),
        fallbackText: tpl.fallbackNotBound(),
        logPrefix:    '[LINE_PARENT_CHILDREN_FLEX]',
      });
      return;
    }
    await lineSvc.pushParentFlex(lineUserId, {
      flex:         tpl.buildParentChildrenInfoCard(children),
      fallbackText: tpl.fallbackChildrenInfo(children),
      logPrefix:    '[LINE_PARENT_CHILDREN_FLEX]',
    });
    return;
  }

  if (intent === 'help') {
    const linked = await lineSvc.getLinkedParentId(lineUserId);
    await lineSvc.pushParentFlex(lineUserId, {
      flex:         tpl.buildParentHelpCard(Boolean(linked)),
      fallbackText: tpl.fallbackHelp(Boolean(linked)),
      logPrefix:    '[LINE_PARENT_HELP_FLEX]',
    });
    return;
  }

  // Default response — unknown command
  const linked = await lineSvc.getLinkedParentId(lineUserId);
  await lineSvc.pushParentFlex(lineUserId, {
    flex:         tpl.buildParentUnknownCommandCard(Boolean(linked)),
    fallbackText: tpl.fallbackUnknownCommand(Boolean(linked)),
    logPrefix:    '[LINE_PARENT_HELP_FLEX]',
  });
}

// ─── Notification processing endpoint (called by cron or manually) ──────────
// Protected by API key header to prevent unauthorized trigger.
// Set CRON_API_KEY env var and pass it as x-api-key header.

router.post('/process-notifications', (req, res, next) => {
  const cronKey = env.app.cronApiKey;
  if (!cronKey) {
    // Fail CLOSED in production: refuse to run this unauthenticated trigger.
    // (Unreachable in production — env.js requires CRON_API_KEY to boot — kept
    // as defense-in-depth.) In dev/test allow through for convenience.
    if (env.app.nodeEnv === 'production') {
      return res.status(503).json({ success: false, message: 'Notification processing is not configured', errors: [], data: null });
    }
    return next();
  }
  if (!safeKeyEqual(req.headers['x-api-key'], cronKey)) {
    return res.status(401).json({ success: false, message: 'Invalid API key', errors: [], data: null });
  }
  return next();
}, async (req, res) => {
  try {
    const result = await lineSvc.processUnsentNotifications();
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[LINE] Notification processing error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
// Exposed for unit testing.
module.exports.verifySignature = verifySignature;
