'use strict';

/**
 * participation.routes.js — Phase 4 of the closure plan.
 *
 * A unified inbox for "งานที่ต้องมีส่วนร่วม". Deliberately ONE router with one
 * list endpoint rather than a menu entry per action: the role-menu audit found
 * the system already has too many entry points, and adding a page per metric
 * is what made the admin area unusable.
 *
 * Mounted only when FEATURE_PARTICIPATION_CASES=true. Dark by default: when
 * off these paths 404 and the rest of the system is byte-for-byte unchanged.
 *
 * SCOPE. Every read and write is constrained server-side to the caller's own
 * scope, the same way the rest of the API works — a school sees its own cases,
 * an affiliation sees the schools under it, province and admin see all. The
 * scope predicate is in the SQL, so an out-of-scope id yields no rows (404)
 * rather than a forbidden-but-leaked hit.
 */

const express = require('express');
const router = express.Router();

const { pool } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleGuard');
const { sendSuccess, sendError } = require('../utils/response');
const { logAudit } = require('../utils/audit');
const { readIdParam } = require('../utils/pathParams');
const svc = require('../services/participation.service');

router.use(authenticate, requireRole('school', 'affiliation', 'province', 'transport', 'driver', 'admin'));

const LIST_MAX = 100;

/**
 * Builds the scope predicate for the caller.
 *
 * `province` and `admin` are province-wide by design (CLAUDE.md §8), so they
 * get no predicate. Everyone else is pinned to their own `scope_id`, taken
 * from the token and never from the request.
 */
function scopeClause(user) {
  switch (user.role) {
    case 'admin':
    case 'province':
      return { sql: '1=1', params: [] };
    case 'affiliation':
      // A case belongs to the affiliation directly, or to one of its schools.
      return {
        sql: `(
          (c.scope_type = 'AFFILIATION' AND c.scope_id = ?)
          OR (c.scope_type = 'SCHOOL' AND c.scope_id IN (
                SELECT s.id FROM schools s WHERE s.affiliation_id = ? AND s.is_deleted = FALSE
             ))
        )`,
        params: [user.scopeId, user.scopeId],
      };
    case 'school':
      return { sql: "(c.scope_type = 'SCHOOL' AND c.scope_id = ?)", params: [user.scopeId] };
    case 'transport':
      return { sql: "c.scope_type = 'TRANSPORT'", params: [] };
    case 'driver':
      // A driver sees only what they raised: they have no organisational scope.
      return { sql: 'c.initiated_by = ?', params: [user.id] };
    default:
      // Deny by default. A role added later without a clause here sees nothing
      // rather than everything.
      return { sql: '1=0', params: [] };
  }
}

/** The scope a caller may create a case in — again from the token, not the body. */
function callerScope(user) {
  switch (user.role) {
    case 'school': return { scope_type: 'SCHOOL', scope_id: user.scopeId };
    case 'affiliation': return { scope_type: 'AFFILIATION', scope_id: user.scopeId };
    case 'province': return { scope_type: 'PROVINCE', scope_id: null };
    case 'transport': return { scope_type: 'TRANSPORT', scope_id: null };
    case 'admin': return null;   // admin must state the scope explicitly
    case 'driver': return null;  // driver must state which school it concerns
    default: return null;
  }
}

// ─── GET /api/participation/cases ───────────────────────────────────────────
router.get('/cases', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(LIST_MAX, Math.max(1, parseInt(req.query.per_page, 10) || 20));
    const offset = (page - 1) * perPage;

    const scope = scopeClause(req.user);
    const filters = [scope.sql];
    const params = [...scope.params];

    if (req.query.status) {
      if (!svc.CASE_STATUSES.includes(req.query.status)) {
        return sendError(res, 'status ไม่ถูกต้อง', [], 400);
      }
      filters.push('c.status = ?');
      params.push(req.query.status);
    }
    if (req.query.case_type) {
      if (!svc.CASE_TYPES.includes(req.query.case_type)) {
        return sendError(res, 'case_type ไม่ถูกต้อง', [], 400);
      }
      filters.push('c.case_type = ?');
      params.push(req.query.case_type);
    }
    // "งานที่ต้องมีส่วนร่วม": everything still waiting on someone.
    if (req.query.open === 'true') {
      filters.push("c.status NOT IN ('CLOSED','WITHDRAWN')");
    }

    const where = filters.join(' AND ');
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM participation_cases c WHERE ${where}`, params
    );
    const [rows] = await pool.query(
      `SELECT c.id, c.case_no, c.case_type, c.subject, c.scope_type, c.scope_id,
              c.initiated_role, c.status, c.decision, c.decided_at,
              c.assigned_to, c.due_at, c.completed_at, c.feedback_sent_at,
              c.linked_entity_type, c.linked_entity_id, c.created_at, c.updated_at
         FROM participation_cases c
        WHERE ${where}
        ORDER BY c.created_at DESC
        LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    return sendSuccess(res, rows, 'OK', { page, per_page: perPage, total });
  } catch (err) { return next(err); }
});

// ─── GET /api/participation/cases/:id ───────────────────────────────────────
router.get('/cases/:id', async (req, res, next) => {
  try {
    const id = readIdParam(req, res);
    if (id === null) return;

    const scope = scopeClause(req.user);
    const [[row]] = await pool.query(
      `SELECT c.* FROM participation_cases c WHERE c.id = ? AND ${scope.sql}`,
      [id, ...scope.params]
    );
    if (!row) return sendError(res, 'ไม่พบเรื่องที่ต้องการ', [], 404);

    const [events] = await pool.query(
      `SELECT id, event_type, actor_role, note, evidence_ref, occurred_at
         FROM participation_case_events
        WHERE case_id = ?
        ORDER BY occurred_at ASC, id ASC`,
      [id]
    );
    return sendSuccess(res, { ...row, events });
  } catch (err) { return next(err); }
});

// ─── POST /api/participation/cases ──────────────────────────────────────────
router.post('/cases', async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const own = callerScope(req.user);
    const input = {
      ...req.body,
      // Scope comes from the token for every role that has one. Admin and
      // driver must state it, and it is validated against the allowlist.
      ...(own || {}),
      initiated_role: req.user.role,
    };

    await conn.beginTransaction();
    const created = await svc.createCase(conn, { input, userId: req.user.id });
    await logAudit({
      userId: req.user.id, action: 'CREATE', entityType: 'participation_case',
      entityId: String(created.id),
      newValue: { case_no: created.case_no, case_type: input.case_type, scope_type: input.scope_type },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], conn,
    });
    await conn.commit();
    return sendSuccess(res, created, 'บันทึกเรื่องสำเร็จ', null, 201);
  } catch (err) {
    try { await conn.rollback(); } catch { /* preserve original error */ }
    return next(err);
  } finally {
    conn.release();
  }
});

// ─── POST /api/participation/cases/:id/events ───────────────────────────────
router.post('/cases/:id/events', async (req, res, next) => {
  const id = readIdParam(req, res);
  if (id === null) return;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Scope is re-checked inside the transaction, against the same predicate
    // the list uses, so an id from another scope cannot be advanced.
    const scope = scopeClause(req.user);
    const [[visible]] = await conn.query(
      `SELECT c.id FROM participation_cases c WHERE c.id = ? AND ${scope.sql}`,
      [id, ...scope.params]
    );
    if (!visible) {
      await conn.rollback();
      return sendError(res, 'ไม่พบเรื่องที่ต้องการ', [], 404);
    }

    const result = await svc.appendEvent(conn, {
      caseId: id,
      input: { ...req.body, actor_role: req.user.role },
      userId: req.user.id,
    });
    await logAudit({
      userId: req.user.id, action: 'UPDATE', entityType: 'participation_case_event',
      entityId: String(id),
      newValue: { event: result.event, status: result.status },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], conn,
    });
    await conn.commit();
    return sendSuccess(res, result, 'บันทึกเหตุการณ์สำเร็จ', null, 201);
  } catch (err) {
    try { await conn.rollback(); } catch { /* preserve original error */ }
    return next(err);
  } finally {
    conn.release();
  }
});

// ─── GET /api/participation/summary ─────────────────────────────────────────
// Aggregate only. Kept separate from the operational dashboard: mixing "how
// many buses ran" with "how many voices were answered" is what left the
// previous metric set unable to say anything about participation.
router.get('/summary', async (req, res, next) => {
  try {
    const scope = scopeClause(req.user);
    const [rows] = await pool.query(
      `SELECT c.status, c.case_type, c.initiated_role, c.decision, c.decision_rationale,
              c.due_at, c.completed_at, c.feedback_sent_at
         FROM participation_cases c
        WHERE ${scope.sql}`,
      scope.params
    );
    return sendSuccess(res, svc.summariseParticipation(rows));
  } catch (err) { return next(err); }
});

module.exports = router;
module.exports._test = { scopeClause, callerScope };
