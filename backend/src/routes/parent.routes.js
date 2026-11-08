'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { sendSuccess, sendError } = require('../utils/response');
const { readIdParam } = require('../utils/pathParams');
const lineSvc = require('../services/line.service');
const idTokenSvc = require('../services/lineIdToken.service');
const { isVerificationUnavailable } = require('../utils/lineVerificationError');
const tpl = require('../services/lineFlexTemplates.service');
const bindGuard = require('../services/lineBindGuard');
const parentConsent = require('../services/parentConsentGate');
const { createUserKeyedLimiter, lineUserOrIpKey, ipKey } = require('../middleware/rateLimiters');
const { normalizePhone, isValidPhone } = require('../utils/phone');

// Consent gate for a child-detail endpoint. Dark by default (guardParentView
// short-circuits with no DB hit), so live behaviour is unchanged until
// FEATURE_PARENT_CONSENT_REQUIRED is turned on. Returns true when the request
// may proceed; otherwise it has already sent a 403 and the caller must return.
async function ensureParentConsent(req, res) {
  const gate = await parentConsent.guardParentView(req.lineUserId);
  if (!gate.allowed) {
    sendError(res, 'กรุณายินยอมการเข้าถึงข้อมูลการเดินทางของบุตรหลานก่อนใช้งาน', [{ code: 'PARENT_CONSENT_REQUIRED' }], 403);
    return false;
  }
  return true;
}

// KEYING (readiness parent-03 / load-06, 2026-11): these limits used to be per
// IP only. A training room or a school office (dozens of phones behind one NAT
// address) then shared ONE budget, so only ~6 parents could link per 10 minutes
// and 15-20 phones opening the status page went over 60/min. Each limit is now
// two layers:
//   1. a per-IP FLOOR, sized for a full room, that runs before any LINE verify
//      call so a flood of junk tokens still cannot reach LINE unbounded;
//   2. the original per-person budget, keyed by the SERVER-VERIFIED LINE sub
//      (req.lineUserId), falling back to the IP when there is no verified sub.
// Brute force on the bind credential is still bounded per credential and per
// sub by lineBindGuard (DB-backed lockout).
const PARENT_LIMIT_MSG = { success: false, message: 'มีการใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่', errors: [], data: null };
const BIND_LIMIT_MSG = { success: false, message: 'มีการพยายามผูกบัญชีหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง', errors: [], data: null };

const parentIpFloorLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600, // ~60 phones x 10 requests/min from one address
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: PARENT_LIMIT_MSG,
});
router.use(parentIpFloorLimiter);

// Per verified LINE user: 60 requests per minute (parents querying status).
const parentLimiter = createUserKeyedLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: PARENT_LIMIT_MSG,
  keyGenerator: lineUserOrIpKey,
  skipInTest: false,
});

// Audit 2026-06-18 (line-integration / auth-crypto): account BINDING is far more
// sensitive than read traffic — a (phone, studentId) pair authorizes linking to a
// child. The generous 60/min limiter made guessing cheap, so bind endpoints get a
// much tighter budget (now per verified LINE user, see KEYING above). NOTE
// (residual): the strongest fix is proof of phone ownership (SMS OTP) or a
// school-issued one-time claim code; that needs an SMS provider decision and is
// tracked separately.
const bindIpFloorLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 150, // ~60 parents x preview+confirm, plus retries, from one address
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  skip: () => process.env.NODE_ENV === 'test',
  message: BIND_LIMIT_MSG,
});
const bindLimiter = createUserKeyedLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 12,
  message: BIND_LIMIT_MSG,
  keyGenerator: lineUserOrIpKey,
});

/**
 * Verify the bind request's LIFF id_token BEFORE the per-user bind limiter so
 * the limiter can key on the verified sub. Never rejects: the handler still
 * owns the 400/401/503 responses and reuses this result (req.lineVerify)
 * instead of verifying a second time.
 */
async function attachBindLineIdentity(req, _res, next) {
  try {
    const idToken = req.body && req.body.idToken;
    const verify = await idTokenSvc.verifyIdToken(idToken);
    req.lineVerify = verify;
    if (verify && verify.valid && verify.userId) req.lineUserId = verify.userId;
    return next();
  } catch (err) {
    return next(err);
  }
}
const bindGuards = [bindIpFloorLimiter, attachBindLineIdentity, bindLimiter];

/**
 * Parent REST API — for LIFF parent access (status / history view).
 *
 * Identity is established ONLY by a server-verified LINE LIFF id_token. The
 * canonical lineUserId is the `sub` returned by LINE's verify endpoint; a
 * client-supplied `line_user_id` is never trusted as identity (Phase 10.12C —
 * closes H1). Child-level endpoints additionally verify the requested student
 * is linked to the verified LINE user before returning any data.
 */

/**
 * requireParentLineAuth — verify a LIFF id_token and set req.lineUserId to the
 * LINE-verified `sub`. Token is read from `Authorization: Bearer <idToken>`
 * (preferred) or an `id_token` query/body param (GET-friendly fallback).
 * Never trusts `line_user_id`. Logs are id-redacted (error code only).
 */
async function requireParentLineAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const token =
      bearer ||
      (req.body && typeof req.body.id_token === 'string' ? req.body.id_token : '') ||
      '';

    if (!token) {
      return sendError(res, 'กรุณาเปิดผ่าน LINE และผูกบัญชีก่อนใช้งาน', [], 401);
    }

    const verify = await idTokenSvc.verifyIdToken(token);
    if (!verify.valid && isVerificationUnavailable(verify)) {
      return sendError(res, 'LINE ยังไม่พร้อมยืนยันบัญชี กรุณาลองใหม่', [
        { code: 'LINE_VERIFY_UNAVAILABLE' },
      ], 503);
    }
    if (!verify.valid) {
      console.warn('[PARENT_API] id_token_invalid', { error: verify.error });
      return sendError(res, 'ไม่สามารถยืนยันบัญชี LINE ได้ กรุณาเปิดผ่านลิงก์ใน LINE OA อีกครั้ง', [], 401);
    }

    req.lineUserId = verify.userId;
    return next();
  } catch (err) {
    return next(err);
  }
}

// ─── GET /api/parent/children ───────────────────────────────────────────────
// Returns linked children for the verified LINE parent user.
router.get('/children', requireParentLineAuth, parentLimiter, async (req, res, next) => {
  try {
    const children = await lineSvc.getLinkedChildren(req.lineUserId);

    // This list carries plate_no and driver_name, so leaving it ungated made
    // the consent gate defeatable by reading the list instead of the detail
    // endpoints. When the gate is on and consent is missing, those two fields
    // are redacted and `consent_required` tells the LIFF UI to prompt —
    // returning an empty list instead would read as "you have no children".
    const gate = await parentConsent.guardParentView(req.lineUserId);
    const result = parentConsent.applyChildListGate(children, gate);

    sendSuccess(res, result.children, 'OK', {
      consent_required: result.consent_required,
      consent_granted: result.consent_granted,
    });
  } catch (err) { next(err); }
});

// ─── GET /api/parent/children/:id/status ────────────────────────────────────
// Returns today's checkin/checkout status for a specific child.
router.get('/children/:id/status', requireParentLineAuth, parentLimiter, async (req, res, next) => {
  try {
    const studentId = readIdParam(req, res);
    if (studentId === null) return;

    // Verify the verified LINE user is linked to this student.
    const children = await lineSvc.getLinkedChildren(req.lineUserId);
    const child = children.find(c => c.id === studentId);
    if (!child) return sendError(res, 'Student not linked to this account', [], 403);
    if (!(await ensureParentConsent(req, res))) return;

    const status = await lineSvc.getChildStatusToday(studentId);
    sendSuccess(res, { ...child, ...status });
  } catch (err) { next(err); }
});

// ─── GET /api/parent/children/:id/history ───────────────────────────────────
// Returns recent checkin/checkout history for a child (last 7 days).
router.get('/children/:id/history', requireParentLineAuth, parentLimiter, async (req, res, next) => {
  try {
    const studentId = readIdParam(req, res);
    if (studentId === null) return;

    // Verify linkage to the verified LINE user.
    const children = await lineSvc.getLinkedChildren(req.lineUserId);
    const child = children.find(c => c.id === studentId);
    if (!child) return sendError(res, 'Student not linked to this account', [], 403);
    if (!(await ensureParentConsent(req, res))) return;

    // Audit 2026-06-18 (limitations): clamp the window so a huge ?days can't scan
    // unbounded history.
    // P-09 (parent audit 2026-11-08, owner-approved): at most 30 days, and
    // never from before the day this LINE account was bound — a newly (maybe
    // wrongly) bound account must not read months of a child's travel pattern.
    const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 30);
    const [rows] = await pool.query(
      `SELECT check_date, session, status, checked_at
       FROM checkin_logs
       WHERE student_id = ? AND check_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND check_date >= COALESCE(
               (SELECT DATE(lb.bound_at) FROM line_bindings lb
                 WHERE lb.line_user_id = ? AND lb.is_active = TRUE LIMIT 1),
               '1000-01-01')
       ORDER BY check_date DESC, checked_at DESC
       LIMIT 500`,
      [studentId, days, req.lineUserId]
    );

    sendSuccess(res, { student: child, history: rows });
  } catch (err) { next(err); }
});

// ─── GET /api/parent/children/:id/eta ────────────────────────────────────────
// Phase 11A (2026-06-23) — predicted ETA of the child's bus at their pickup
// point. Returns a structured response: either ETA data or an error code
// ('feature_disabled', 'no_vehicle', 'no_pickup_point', 'vehicle_offline').
// The response contains NO PII — only the pickup point label, ETA seconds,
// distance, and confidence.
router.get('/children/:id/eta', requireParentLineAuth, parentLimiter, async (req, res, next) => {
  try {
    const studentId = readIdParam(req, res);
    if (studentId === null) return;

    const children = await lineSvc.getLinkedChildren(req.lineUserId);
    const child = children.find(c => c.id === studentId);
    if (!child) return sendError(res, 'Student not linked to this account', [], 403);
    if (!(await ensureParentConsent(req, res))) return;

    const etaSvc = require('../services/eta.service');
    const eta = await etaSvc.getForStudent(studentId);
    return sendSuccess(res, eta);
  } catch (err) { next(err); }
});

// ─── LIFF bind flow (Phase 10.3E-UX1) ───────────────────────────────────────
// Two-step server-trusted bind: preview (read-only) then confirm (writes).
// Both endpoints require a valid LIFF ID token — line_user_id is NEVER taken
// from the request body. The canonical lineUserId is the `sub` field of the
// LINE-verified token, full stop.

// Shared normalization (parent-02): the same canonical form the importers store.
function validatePhone(raw) {
  if (typeof raw !== 'string') return null;
  const s = normalizePhone(raw);
  return isValidPhone(s) ? s : null;
}

function validateStudentId(raw) {
  const n = typeof raw === 'string' || typeof raw === 'number' ? parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Phase 10.13C-4A — the credential is the VISIBLE รหัสนักเรียน (student_code), which
// may be non-numeric for newly-imported students. Accept a trimmed 1–50 char code.
// The frontend currently posts it in the `studentId` field; a `student_code` field
// is preferred and takes precedence when present.
function validateStudentCredential(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s.length < 1 || s.length > 50) return null;
  return s;
}

// POST /api/parent/line/bind-preview
// body: { idToken, phone, studentId }
// → 200 { student: { ... }, masked_phone: "090****567" }   parent may proceed
// → 400 invalid input
// → 401 idToken invalid
// → 404 phone+studentId combo not found
// → 409 already linked (different parent)
router.post('/line/bind-preview', bindGuards, async (req, res, next) => {
  const meta = { ip: req.ip, ua: req.headers['user-agent'] };
  try {
    const { idToken, phone, studentId, student_code } = req.body || {};
    const errors = [];
    const cleanPhone = validatePhone(phone);
    const credential = validateStudentCredential(student_code != null ? student_code : studentId);
    if (!cleanPhone)  errors.push({ field: 'phone',     message: 'กรุณากรอกเบอร์โทรศัพท์ 10 หลัก' });
    if (!credential)  errors.push({ field: 'studentId', message: 'กรุณากรอกรหัสนักเรียน' });
    if (errors.length) return sendError(res, 'ข้อมูลไม่ถูกต้อง', errors, 400);

    // Phase 10.13C-4A — credential lockout (before the credential lookup), so a
    // brute-force can't be bypassed by rotating IPs.
    // parent-07: the per-student lock is scoped to the school the code resolves to.
    const studentLockKey = await bindGuard.resolveStudentLockKey(credential);
    const keys = bindGuard.keysFor({ phone: cleanPhone, studentKey: credential, studentLockKey });
    const lock = await bindGuard.checkLock(keys);
    if (lock.locked) {
      await lineSvc.auditBind({ phone: cleanPhone, studentCode: credential, action: 'LINE_BIND_LOCKED', reason: lock.reason, ...meta });
      return sendError(res, 'พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง', [], 429);
    }

    // Verified once by attachBindLineIdentity (for the per-user limiter).
    const verify = req.lineVerify || await idTokenSvc.verifyIdToken(idToken);
    if (!verify.valid) {
      if (isVerificationUnavailable(verify)) {
        return sendError(res, 'LINE ยังไม่พร้อมยืนยันบัญชี กรุณาลองใหม่', [
          { code: 'LINE_VERIFY_UNAVAILABLE' },
        ], 503);
      }
      console.warn('[LINE_BIND_PREVIEW] id_token_invalid', { error: verify.error });
      return sendError(res, 'ไม่สามารถยืนยันบัญชี LINE ของคุณได้ กรุณาเปิดผ่านลิงก์ใน LINE OA อีกครั้ง', [], 401);
    }
    const lineUserId = verify.userId;
    const subKeys = bindGuard.keysFor({ phone: cleanPhone, studentKey: credential, studentLockKey, sub: lineUserId });
    const subLock = await bindGuard.checkLock({ sub: subKeys.sub });
    if (subLock.locked) {
      await lineSvc.auditBind({ sub: lineUserId, phone: cleanPhone, studentCode: credential, action: 'LINE_BIND_LOCKED', reason: subLock.reason, ...meta });
      return sendError(res, 'พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง', [], 429);
    }

    // If this LINE userId is already bound to someone, surface that early so
    // the form can guide them to "ยกเลิกผูกบัญชี" first.
    const existing = await lineSvc.getLinkedParentId(lineUserId);
    if (existing) {
      await lineSvc.auditBind({ sub: lineUserId, phone: cleanPhone, studentCode: credential, action: 'LINE_BIND_DUPLICATE_OR_ALREADY_BOUND', reason: 'ALREADY_BOUND', ...meta });
      return sendError(res, 'บัญชี LINE นี้ผูกอยู่กับผู้ปกครองท่านอื่นแล้ว กรุณาพิมพ์ "ยกเลิกผูกบัญชี" ก่อน', [], 409);
    }

    const match = await lineSvc.findLinkableParent(cleanPhone, credential);
    if (!match.found) {
      await bindGuard.noteFailure(subKeys);
      await lineSvc.auditBind({ sub: lineUserId, phone: cleanPhone, studentCode: credential, action: 'LINE_BIND_PREVIEW_FAILED', reason: 'CREDENTIAL_MISMATCH', ...meta });
      return sendError(res, 'ไม่พบข้อมูลที่ตรงกัน กรุณาตรวจสอบรหัสนักเรียนและเบอร์โทรศัพท์', [], 404);
    }

    await bindGuard.noteSuccess(subKeys); // valid credential — clear the pair counter

    // parent-08: one phone binds to one LINE account. Say so here, before the
    // preview card, instead of letting the second guardian hit it at confirm.
    const phoneOwner = await lineSvc.getLineUserIdByPhone(cleanPhone);
    if (phoneOwner && phoneOwner !== lineUserId) {
      await lineSvc.auditBind({ sub: lineUserId, phone: cleanPhone, studentCode: match.studentCode || credential, action: 'LINE_BIND_DUPLICATE_OR_ALREADY_BOUND', reason: 'PHONE_BOUND_TO_OTHER', ...meta });
      return sendError(res, lineSvc.PHONE_BOUND_TO_OTHER_MSG, [{ field: 'phone', code: 'PHONE_BOUND_TO_OTHER' }], 409);
    }

    // P-02: every child this binding will expose (keyed on the phone).
    const visible = await lineSvc.getChildrenByPhone(cleanPhone);
    console.log('[LINE_BIND_PREVIEW] ok', { hasStudent: true });
    return sendSuccess(res, {
      student: match.student,
      masked_phone: tpl.maskPhone(cleanPhone),
      children: Array.isArray(visible) ? visible : [],
    });
  } catch (err) { return next(err); }
});

// POST /api/parent/line/bind-confirm
// body: { idToken, phone, studentId }
// → 201 success
// → same error codes as preview
router.post('/line/bind-confirm', bindGuards, async (req, res, next) => {
  const meta = { ip: req.ip, ua: req.headers['user-agent'] };
  try {
    const { idToken, phone, studentId, student_code } = req.body || {};
    const cleanPhone = validatePhone(phone);
    const credential = validateStudentCredential(student_code != null ? student_code : studentId);
    if (!cleanPhone || !credential) {
      return sendError(res, 'ข้อมูลไม่ถูกต้อง', [], 400);
    }

    // Credential lockout before lookup (see bind-preview).
    // parent-07: the per-student lock is scoped to the school the code resolves to.
    const studentLockKey = await bindGuard.resolveStudentLockKey(credential);
    const keys = bindGuard.keysFor({ phone: cleanPhone, studentKey: credential, studentLockKey });
    const lock = await bindGuard.checkLock(keys);
    if (lock.locked) {
      await lineSvc.auditBind({ phone: cleanPhone, studentCode: credential, action: 'LINE_BIND_LOCKED', reason: lock.reason, ...meta });
      return sendError(res, 'พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง', [], 429);
    }

    // Verified once by attachBindLineIdentity (for the per-user limiter).
    const verify = req.lineVerify || await idTokenSvc.verifyIdToken(idToken);
    if (!verify.valid) {
      if (isVerificationUnavailable(verify)) {
        return sendError(res, 'LINE ยังไม่พร้อมยืนยันบัญชี กรุณาลองใหม่', [
          { code: 'LINE_VERIFY_UNAVAILABLE' },
        ], 503);
      }
      console.warn('[LINE_BIND_CONFIRM] id_token_invalid', { error: verify.error });
      return sendError(res, 'ไม่สามารถยืนยันบัญชี LINE ของคุณได้ กรุณาเปิดผ่านลิงก์ใน LINE OA อีกครั้ง', [], 401);
    }
    const lineUserId = verify.userId;
    const subKeys = bindGuard.keysFor({ phone: cleanPhone, studentKey: credential, studentLockKey, sub: lineUserId });
    const subLock = await bindGuard.checkLock({ sub: subKeys.sub });
    if (subLock.locked) {
      await lineSvc.auditBind({ sub: lineUserId, phone: cleanPhone, studentCode: credential, action: 'LINE_BIND_LOCKED', reason: subLock.reason, ...meta });
      return sendError(res, 'พยายามหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง', [], 429);
    }

    const existing = await lineSvc.getLinkedParentId(lineUserId);
    if (existing) {
      await lineSvc.auditBind({ sub: lineUserId, phone: cleanPhone, studentCode: credential, action: 'LINE_BIND_DUPLICATE_OR_ALREADY_BOUND', reason: 'ALREADY_BOUND', ...meta });
      return sendError(res, 'บัญชี LINE นี้ผูกอยู่แล้ว', [], 409);
    }
    const match = await lineSvc.findLinkableParent(cleanPhone, credential);
    if (!match.found) {
      await bindGuard.noteFailure(subKeys);
      await lineSvc.auditBind({ sub: lineUserId, phone: cleanPhone, studentCode: credential, action: 'LINE_BIND_CONFIRM_FAILED', reason: 'CREDENTIAL_MISMATCH', ...meta });
      return sendError(res, 'ไม่พบข้อมูลที่ตรงกัน กรุณาตรวจสอบรหัสนักเรียนและเบอร์โทรศัพท์', [], 404);
    }

    try {
      await lineSvc.commitLineLink(lineUserId, match.parentId);
    } catch (bindErr) {
      // Phone-binding conflict (Round 1) — surface as 409 with a localized msg.
      if (bindErr instanceof lineSvc.LineBindConflictError) {
        console.warn('[LINE_BIND_CONFIRM] conflict', { code: bindErr.code });
        await lineSvc.auditBind({ sub: lineUserId, phone: cleanPhone, studentCode: match.studentCode || credential, action: 'LINE_BIND_DUPLICATE_OR_ALREADY_BOUND', reason: 'ALREADY_BOUND', ...meta });
        return sendError(res, bindErr.message, [{ field: 'phone', code: bindErr.code }], 409);
      }
      throw bindErr;
    }
    await bindGuard.noteSuccess(subKeys);
    await lineSvc.auditBind({ sub: lineUserId, phone: cleanPhone, studentCode: match.studentCode || credential, action: 'LINE_BIND_SUCCESS', reason: 'SUCCESS', ...meta });
    await lineSvc.logMessage(lineUserId, 'system', 'bind_success_liff', 'ok', `parent_id=${match.parentId}`);
    console.log('[LINE_BIND_CONFIRM] linked', { parentId: match.parentId });

    // Push the standard HF4.2 success Flex card to the OA so the chat thread
    // also reflects the binding (parent sees both in-LIFF success + the OA
    // card). Best-effort: a push failure here does NOT undo the bind.
    try {
      const children = await lineSvc.getLinkedChildren(lineUserId);
      await lineSvc.pushParentFlex(lineUserId, {
        flex:         tpl.buildParentBindSuccessCard(children),
        fallbackText: tpl.fallbackBindSuccess(children),
        logPrefix:    '[LINE_PARENT_BIND_FLEX]',
      });
    } catch (pushErr) {
      console.warn('[LINE_BIND_CONFIRM] post_push_failed', { error: pushErr.message });
    }

    return sendSuccess(res, { ok: true }, 'ผูกบัญชีสำเร็จ', null, 201);
  } catch (err) { return next(err); }
});

module.exports = router;
