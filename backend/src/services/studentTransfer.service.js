'use strict';

// Phase 10.13B-6 — guarded student transfer / wrong-school correction.
// A request changes NO student data. Apply (admin approval only) uses Option B:
// soft-close the source student + create a fresh destination student (atomic id),
// preserving the source school's history (checkins/leaves stay under source).

const crypto = require('crypto');
const { logAudit } = require('../utils/audit');
const { allocateStudentId } = require('./idAllocator.service');
const { getCurrentTermCachedSync } = require('./term.service');

const REQUEST_TYPES = ['TRANSFER_TO_SCHOOL', 'WRONG_SCHOOL_CORRECTION'];

function notFound(msg) { const e = new Error(msg); e.statusCode = 404; return e; }
function forbidden(msg) { const e = new Error(msg); e.statusCode = 403; return e; }
function badReq(msg) { const e = new Error(msg); e.statusCode = 400; return e; }
function conflict(msg) { const e = new Error(msg); e.statusCode = 409; return e; }

// ── School: create a transfer-out request for a student it owns. ─────────────
async function createRequest(pool, { studentId, schoolId, userId, destinationSchoolId, reason, evidenceNote, requestType = 'TRANSFER_TO_SCHOOL' }) {
  if (!REQUEST_TYPES.includes(requestType)) throw badReq('ประเภทคำขอไม่ถูกต้อง');
  if (!destinationSchoolId) throw badReq('กรุณาระบุโรงเรียนปลายทาง');
  if (String(destinationSchoolId) === String(schoolId)) throw badReq('ไม่สามารถโอนย้ายไปโรงเรียนเดิมได้');

  const [[st]] = await pool.query('SELECT id, school_id, student_code, prefix, first_name, last_name, is_deleted FROM students WHERE id = ?', [studentId]);
  if (!st) throw notFound('ไม่พบนักเรียน');
  if (String(st.school_id) !== String(schoolId)) throw forbidden('ไม่มีสิทธิ์ส่งคำขอสำหรับนักเรียนของโรงเรียนอื่น');
  if (st.is_deleted) throw badReq('นักเรียนนี้ถูกลบแล้ว ไม่สามารถส่งคำขอโอนย้ายได้');

  // The source school's affiliation rides along so the caller can tell the
  // requester who decides: same affiliation → the affiliation (or admin);
  // different affiliation → the destination school (QA affiliation-03).
  const [[dest]] = await pool.query(
    `SELECT id, name, affiliation_id,
            (SELECT src.affiliation_id FROM schools src WHERE src.id = ?) AS source_affiliation_id
       FROM schools WHERE id = ? AND COALESCE(is_deleted, FALSE) = FALSE`,
    [schoolId, destinationSchoolId]);
  if (!dest) throw badReq('ไม่พบโรงเรียนปลายทาง');
  const crossAffiliation = isCrossAffiliation({ source_affiliation_id: dest.source_affiliation_id, destination_affiliation_id: dest.affiliation_id });

  const [[existing]] = await pool.query("SELECT id FROM student_transfer_requests WHERE student_id = ? AND status = 'PENDING' LIMIT 1", [studentId]);
  if (existing) { const e = conflict('มีคำขอโอนย้ายที่รออนุมัติสำหรับนักเรียนคนนี้อยู่แล้ว'); e.errors = [{ code: 'PENDING_REQUEST_EXISTS', request_id: existing.id }]; throw e; }

  const name = `${st.prefix || ''}${st.first_name || ''} ${st.last_name || ''}`.trim();
  const [r] = await pool.query(
    `INSERT INTO student_transfer_requests
       (request_type, status, student_id, student_code, student_name_snapshot, source_school_id, destination_school_id, requested_by, reason, evidence_note)
     VALUES (?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [requestType, studentId, st.student_code, name, schoolId, destinationSchoolId, userId, String(reason || '').slice(0, 500), String(evidenceNote || '').slice(0, 500)]
  );
  await logAudit({ userId, action: 'CREATE', entityType: 'student_transfer_request', entityId: String(r.insertId),
    newValue: { student_id: studentId, source: schoolId, destination: destinationSchoolId, type: requestType, cross_affiliation: crossAffiliation } });
  return { id: r.insertId, status: 'PENDING', cross_affiliation: crossAffiliation, approver: crossAffiliation ? APPROVER.DESTINATION_SCHOOL : APPROVER.AFFILIATION };
}

// ── Who decides a request (QA affiliation-03) ────────────────────────────────
// A transfer between two schools of the SAME affiliation is decided by that
// affiliation (or a system admin), as before. A transfer into a school of a
// DIFFERENT affiliation is decided by the destination school itself: it is the
// school that receives the pupil and whose staff the guardians' LINE access
// will point at, so the source affiliation must not be able to push a child in
// unseen. Decided from the schools' CURRENT affiliation at read time; a school
// with no affiliation counts as different from one that has one. No schema
// change: the request row already carries both school ids.
const APPROVER = { AFFILIATION: 'AFFILIATION', DESTINATION_SCHOOL: 'DESTINATION_SCHOOL' };
function isCrossAffiliation(row) {
  const a = row.source_affiliation_id == null ? null : String(row.source_affiliation_id);
  const b = row.destination_affiliation_id == null ? null : String(row.destination_affiliation_id);
  return a !== b;
}

const pubRow = (q) => ({
  id: q.id, request_type: q.request_type, status: q.status, student_id: q.student_id, student_code: q.student_code,
  student_name: q.student_name_snapshot, source_school_id: q.source_school_id, source_school_name: q.source_school_name,
  destination_school_id: q.destination_school_id, destination_school_name: q.destination_school_name,
  reason: q.reason, admin_note: q.admin_note, evidence_note: q.evidence_note, applied_student_id: q.applied_student_id,
  created_at: q.created_at, approved_at: q.approved_at, rejected_at: q.rejected_at, applied_at: q.applied_at,
  cross_affiliation: isCrossAffiliation(q),
  approver: isCrossAffiliation(q) ? APPROVER.DESTINATION_SCHOOL : APPROVER.AFFILIATION,
});
const JOIN_SCHOOLS = `LEFT JOIN schools ss ON ss.id = q.source_school_id LEFT JOIN schools ds ON ds.id = q.destination_school_id`;
const SELECT_COLS = `q.*, ss.name AS source_school_name, ds.name AS destination_school_name,
  ss.affiliation_id AS source_affiliation_id, ds.affiliation_id AS destination_affiliation_id`;

// ── School: list requests involving this school. ─────────────────────────────
async function listForSchool(pool, { schoolId }) {
  const [rows] = await pool.query(
    `SELECT ${SELECT_COLS} FROM student_transfer_requests q ${JOIN_SCHOOLS}
     WHERE q.source_school_id = ? OR q.destination_school_id = ? ORDER BY q.id DESC LIMIT 200`, [schoolId, schoolId]);
  return rows.map((q) => {
    const out = pubRow(q);
    const incoming = String(q.destination_school_id) === String(schoolId);
    out.direction = incoming ? 'INCOMING' : 'OUTGOING';
    // Only an incoming cross-affiliation request is this school's to decide.
    out.can_decide = incoming && out.cross_affiliation && q.status === 'PENDING';
    return out;
  });
}

// ── Destination school: decide an incoming cross-affiliation request ────────
// Scope is enforced here, not in the client: the row must name the caller's
// school as destination_school_id. The route additionally refuses grade-scoped
// teacher accounts (requireFullSchoolScope).
async function loadForDestinationSchool(pool, { requestId, schoolId }) {
  if (!schoolId) throw badReq('กรุณาระบุโรงเรียน');
  const [[row]] = await pool.query(
    `SELECT ${SELECT_COLS} FROM student_transfer_requests q ${JOIN_SCHOOLS}
     WHERE q.id = ? AND q.destination_school_id = ?`, [requestId, schoolId]);
  if (!row) throw notFound('ไม่พบคำขอ หรือคำขอนี้ไม่ได้โอนเข้าโรงเรียนของคุณ');
  return row;
}

// Only what the receiving school needs to decide: who, from where, why, which
// grade, and the pre-approval warnings. No source-school internal ids.
async function getIncomingDetailForSchool(pool, { requestId, schoolId }) {
  const row = await loadForDestinationSchool(pool, { requestId, schoolId });
  const [[st]] = await pool.query('SELECT grade, classroom, is_deleted FROM students WHERE id = ?', [row.student_id]);
  const [[destDup]] = await pool.query('SELECT id FROM students WHERE school_id = ? AND student_code = ? AND COALESCE(is_deleted, FALSE) = FALSE LIMIT 1', [row.destination_school_id, row.student_code]);
  const [[links]] = await pool.query('SELECT SUM(approved = TRUE) AS approved_total FROM parent_student WHERE student_id = ?', [row.student_id]);
  const cross = isCrossAffiliation(row);
  return {
    id: row.id, request_type: row.request_type, status: row.status,
    student_code: row.student_code, student_name: row.student_name_snapshot,
    grade: st ? st.grade : null, classroom: st ? st.classroom : null,
    source_school_name: row.source_school_name, destination_school_name: row.destination_school_name,
    reason: row.reason, evidence_note: row.evidence_note, admin_note: row.admin_note,
    created_at: row.created_at, approved_at: row.approved_at, rejected_at: row.rejected_at, applied_at: row.applied_at,
    cross_affiliation: cross,
    approver: cross ? APPROVER.DESTINATION_SCHOOL : APPROVER.AFFILIATION,
    guardian_links: Number(links?.approved_total || 0),
    destination_code_conflict: !!destDup,
    source_student_missing: !st || !!st.is_deleted,
    can_decide: cross && row.status === 'PENDING',
  };
}

function sameAffiliationForbidden() {
  const e = forbidden('คำขอนี้เป็นการโอนย้ายภายในสังกัดเดียวกัน สังกัดเป็นผู้พิจารณาอนุมัติ โรงเรียนปลายทางดำเนินการไม่ได้');
  e.errors = [{ code: 'SAME_AFFILIATION_AFFILIATION_DECIDES' }];
  return e;
}

async function approveAsDestinationSchool(pool, { requestId, schoolId, userId, note }) {
  const row = await loadForDestinationSchool(pool, { requestId, schoolId });
  if (!isCrossAffiliation(row)) throw sameAffiliationForbidden();
  return approveAndApply(pool, { requestId, adminUserId: userId, adminNote: note });
}

async function rejectAsDestinationSchool(pool, { requestId, schoolId, userId, note }) {
  const row = await loadForDestinationSchool(pool, { requestId, schoolId });
  if (!isCrossAffiliation(row)) throw sameAffiliationForbidden();
  return reject(pool, { requestId, adminUserId: userId, adminNote: note });
}

async function cancelRequest(pool, { requestId, schoolId, userId }) {
  const [[req]] = await pool.query('SELECT id, source_school_id, status FROM student_transfer_requests WHERE id = ?', [requestId]);
  if (!req) throw notFound('ไม่พบคำขอ');
  if (String(req.source_school_id) !== String(schoolId)) throw forbidden('ไม่มีสิทธิ์ยกเลิกคำขอนี้');
  if (req.status !== 'PENDING') throw badReq('ยกเลิกได้เฉพาะคำขอที่รออนุมัติเท่านั้น');
  await pool.query("UPDATE student_transfer_requests SET status = 'CANCELLED', updated_at = NOW() WHERE id = ? AND status = 'PENDING'", [requestId]);
  await logAudit({ userId, action: 'UPDATE', entityType: 'student_transfer_request', entityId: String(requestId), newValue: { status: 'CANCELLED' } });
  return { id: requestId, status: 'CANCELLED' };
}

// ── Admin: list + detail (with destination-conflict check). ──────────────────
async function listForAdmin(pool, { status }) {
  const where = status ? 'WHERE q.status = ?' : '';
  const params = status ? [status] : [];
  const [rows] = await pool.query(`SELECT ${SELECT_COLS} FROM student_transfer_requests q ${JOIN_SCHOOLS} ${where} ORDER BY q.status='PENDING' DESC, q.id DESC LIMIT 300`, params);
  return rows.map(pubRow);
}

async function countPendingForAdmin(pool) {
  const [[r]] = await pool.query("SELECT COUNT(*) n FROM student_transfer_requests WHERE status = 'PENDING'");
  return r.n;
}

async function getDetailForAdmin(pool, { requestId }) {
  const [[req]] = await pool.query(`SELECT ${SELECT_COLS} FROM student_transfer_requests q ${JOIN_SCHOOLS} WHERE q.id = ?`, [requestId]);
  if (!req) throw notFound('ไม่พบคำขอ');
  const [[st]] = await pool.query('SELECT id, school_id, student_code, grade, classroom, vehicle_id, is_deleted FROM students WHERE id = ?', [req.student_id]);
  const [[destDup]] = await pool.query('SELECT id FROM students WHERE school_id = ? AND student_code = ? AND COALESCE(is_deleted, FALSE) = FALSE LIMIT 1', [req.destination_school_id, req.student_code]);
  return {
    ...pubRow(req),
    current_student: st ? { school_id: st.school_id, grade: st.grade, classroom: st.classroom, has_vehicle: !!st.vehicle_id, is_deleted: !!st.is_deleted } : null,
    destination_code_conflict: !!destDup,
    can_approve: req.status === 'PENDING',
  };
}

// ── Admin: approve + apply (Option B). Idempotent, audited. ──────────────────
async function approveAndApply(pool, { requestId, adminUserId, adminNote }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[req]] = await conn.query('SELECT * FROM student_transfer_requests WHERE id = ? FOR UPDATE', [requestId]);
    if (!req) throw notFound('ไม่พบคำขอ');
    if (req.status === 'APPLIED') { await conn.commit(); return { status: 'ALREADY_APPLIED', applied_student_id: req.applied_student_id }; }
    if (req.status !== 'PENDING') { await conn.commit(); return { status: req.status }; }

    const [[st]] = await conn.query('SELECT id, school_id, student_code, prefix, first_name, last_name, grade, classroom, is_deleted FROM students WHERE id = ? FOR UPDATE', [req.student_id]);
    // Re-validate the request is still safe to apply.
    if (!st || st.is_deleted || String(st.school_id) !== String(req.source_school_id) || String(st.student_code) !== String(req.student_code)) {
      await conn.query("UPDATE student_transfer_requests SET status='STALE_NEEDS_REVIEW', admin_note=?, updated_at=NOW() WHERE id=?", [String(adminNote || '').slice(0, 500), requestId]);
      await logAudit({ userId: adminUserId, action: 'UPDATE', entityType: 'student_transfer_request', entityId: String(requestId), conn, newValue: { status: 'STALE_NEEDS_REVIEW' } });
      await conn.commit(); return { status: 'STALE_NEEDS_REVIEW' };
    }
    const [[dest]] = await conn.query('SELECT id FROM schools WHERE id = ? AND COALESCE(is_deleted, FALSE) = FALSE', [req.destination_school_id]);
    if (!dest) { await conn.query("UPDATE student_transfer_requests SET status='FAILED', admin_note='destination school missing', updated_at=NOW() WHERE id=?", [requestId]); await logAudit({ userId: adminUserId, action: 'UPDATE', entityType: 'student_transfer_request', entityId: String(requestId), conn, newValue: { status: 'FAILED', reason: 'DESTINATION_MISSING' } }); await conn.commit(); return { status: 'FAILED', reason: 'DESTINATION_MISSING' }; }
    const [[dup]] = await conn.query('SELECT id FROM students WHERE school_id = ? AND student_code = ? AND COALESCE(is_deleted, FALSE) = FALSE LIMIT 1', [req.destination_school_id, req.student_code]);
    if (dup) { await conn.query("UPDATE student_transfer_requests SET status='FAILED', admin_note=?, updated_at=NOW() WHERE id=?", [`destination already has student_code ${req.student_code}`, requestId]); await logAudit({ userId: adminUserId, action: 'UPDATE', entityType: 'student_transfer_request', entityId: String(requestId), conn, newValue: { status: 'FAILED', reason: 'DESTINATION_CODE_EXISTS' } }); await conn.commit(); return { status: 'FAILED', reason: 'DESTINATION_CODE_EXISTS' }; }

    // Option B: soft-close source, create fresh destination student.
    await conn.query('UPDATE students SET is_deleted = TRUE, deleted_at = NOW(), vehicle_id = NULL WHERE id = ?', [st.id]);
    const newId = await allocateStudentId(conn);
    const cid = crypto.createHash('sha256').update(`transfer-${req.destination_school_id}-${st.student_code}`).digest('hex');
    await conn.query(
      `INSERT INTO students (id, student_code, cid_hash, prefix, first_name, last_name, grade, classroom, school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 1, ?)`,
      [newId, st.student_code, cid, st.prefix || null, st.first_name || '-', st.last_name || '-', st.grade || null, st.classroom || null, req.destination_school_id, getCurrentTermCachedSync()]
    );
    // Carry the guardian links across, preserving each one's approval state.
    //
    // This used to take a single row (`LIMIT 1` with no ORDER BY) and write it
    // back with approved = TRUE, which was wrong twice over. A pupil with two
    // guardians silently lost one. Worse, a guardian who had been REVOKED was
    // eligible to be the row picked up — the student-import path sets
    // approved = FALSE on the previous guardian whenever a guardian phone
    // changes (studentImportPreview.service.js) and leaves the row in place —
    // so a transfer could hand a removed guardian access to the child again,
    // stamped with the approving admin's id and with nothing to show it had
    // happened. In a school setting a guardian is usually removed for a
    // custody or safeguarding reason, so that is the wrong direction to fail.
    //
    // A set-based copy fixes both: every link moves, and `approved` (with its
    // approver and timestamp) moves with it, so a revoked guardian stays
    // revoked on the new record.
    const [copied] = await conn.query(
      `INSERT INTO parent_student (parent_id, student_id, relationship, approved, approved_by, approved_at)
       SELECT parent_id, ?, relationship, approved, approved_by, approved_at
         FROM parent_student
        WHERE student_id = ?
       ON DUPLICATE KEY UPDATE
         relationship = VALUES(relationship),
         approved     = VALUES(approved),
         approved_by  = VALUES(approved_by),
         approved_at  = VALUES(approved_at)`,
      [newId, st.id]
    );
    const [[linkCounts]] = await conn.query(
      `SELECT COUNT(*) AS total, SUM(approved = TRUE) AS approved_total
         FROM parent_student WHERE student_id = ?`,
      [newId]
    );

    const beforeJson = { student_id: st.id, school_id: st.school_id };
    const afterJson = {
      applied_student_id: newId,
      school_id: req.destination_school_id,
      // Record what happened to the guardian links. Who may see a child's
      // location is exactly the thing a later complaint asks about, and the
      // transfer is the moment it changes hands.
      guardian_links_copied: Number(copied?.affectedRows || 0),
      guardian_links_total: Number(linkCounts?.total || 0),
      guardian_links_approved: Number(linkCounts?.approved_total || 0),
    };
    await conn.query(
      `UPDATE student_transfer_requests SET status='APPLIED', approved_by=?, approved_at=NOW(), applied_at=NOW(),
         applied_student_id=?, admin_note=?, before_json=CAST(? AS JSON), after_json=CAST(? AS JSON), updated_at=NOW() WHERE id=?`,
      [adminUserId, newId, String(adminNote || '').slice(0, 500), JSON.stringify(beforeJson), JSON.stringify(afterJson), requestId]
    );
    await logAudit({ userId: adminUserId, action: 'UPDATE', entityType: 'student', entityId: String(st.id), conn,
      oldValue: beforeJson, newValue: { transfer: true, request_id: requestId, ...afterJson, request_type: req.request_type } });
    await conn.commit();
    return { status: 'APPLIED', applied_student_id: newId };
  } catch (e) {
    await conn.rollback();
    if (!e.statusCode) {
      const [fr] = await pool.query("UPDATE student_transfer_requests SET status='FAILED', admin_note=?, updated_at=NOW() WHERE id=? AND status='PENDING'", [String(e.code || e.message).slice(0, 400), requestId]);
      if (fr && fr.affectedRows > 0) await logAudit({ userId: adminUserId, action: 'UPDATE', entityType: 'student_transfer_request', entityId: String(requestId), newValue: { status: 'FAILED', reason: String(e.code || e.message).slice(0, 200) } });
    }
    throw e;
  } finally { conn.release(); }
}

async function reject(pool, { requestId, adminUserId, adminNote }) {
  const [[req]] = await pool.query('SELECT id, status FROM student_transfer_requests WHERE id = ?', [requestId]);
  if (!req) throw notFound('ไม่พบคำขอ');
  if (req.status !== 'PENDING') throw badReq('ไม่อนุมัติได้เฉพาะคำขอที่รออนุมัติเท่านั้น');
  await pool.query("UPDATE student_transfer_requests SET status='REJECTED', rejected_by=?, rejected_at=NOW(), admin_note=?, updated_at=NOW() WHERE id=? AND status='PENDING'", [adminUserId, String(adminNote || '').slice(0, 500), requestId]);
  await logAudit({ userId: adminUserId, action: 'UPDATE', entityType: 'student_transfer_request', entityId: String(requestId), newValue: { status: 'REJECTED', admin_note: String(adminNote || '').slice(0, 200) } });
  return { id: requestId, status: 'REJECTED' };
}


// ── Affiliation: list transfer requests touching this affiliation ──────────
// A request shows up when either end is one of this affiliation's schools, with
// a direction relative to the affiliation. Only INTERNAL requests (both schools
// in this affiliation) are the affiliation's to decide; a cross-affiliation one
// waits for the destination school (QA affiliation-03).
function affiliationDirection(row, affiliationId) {
  const fromHere = row.source_affiliation_id != null && String(row.source_affiliation_id) === String(affiliationId);
  const toHere = row.destination_affiliation_id != null && String(row.destination_affiliation_id) === String(affiliationId);
  if (fromHere && toHere) return 'INTERNAL';
  return fromHere ? 'OUTGOING' : 'INCOMING';
}
function affRow(row, affiliationId) {
  const direction = affiliationDirection(row, affiliationId);
  return { ...pubRow(row), direction, can_approve: direction === 'INTERNAL' && row.status === 'PENDING' };
}

async function listForAffiliation(pool, { affiliationId, status = null }) {
  const statusSql = status ? ' AND q.status = ?' : '';
  const params = [affiliationId, affiliationId, ...(status ? [status] : [])];
  const [rows] = await pool.query(
    `SELECT ${SELECT_COLS} FROM student_transfer_requests q ${JOIN_SCHOOLS}
     WHERE (ss.affiliation_id = ? OR ds.affiliation_id = ?)${statusSql}
     ORDER BY q.status='PENDING' DESC, q.id DESC LIMIT 200`,
    params
  );
  return rows.map((r) => affRow(r, affiliationId));
}

async function getDetailForAffiliation(pool, { requestId, affiliationId }) {
  const [[row]] = await pool.query(
    `SELECT ${SELECT_COLS} FROM student_transfer_requests q ${JOIN_SCHOOLS}
     WHERE q.id = ? AND (ss.affiliation_id = ? OR ds.affiliation_id = ?)`,
    [requestId, affiliationId, affiliationId]
  );
  if (!row) throw notFound('ไม่พบคำขอ หรือคำขอนี้ไม่ได้อยู่ในสังกัดของคุณ');
  // Same pre-approval signals as getDetailForAdmin so the affiliation screen
  // can warn before approving (QA affiliation-09).
  const [[st]] = await pool.query('SELECT id, school_id, student_code, grade, classroom, vehicle_id, is_deleted FROM students WHERE id = ?', [row.student_id]);
  const [[destDup]] = await pool.query('SELECT id FROM students WHERE school_id = ? AND student_code = ? AND COALESCE(is_deleted, FALSE) = FALSE LIMIT 1', [row.destination_school_id, row.student_code]);
  return {
    ...affRow(row, affiliationId),
    current_student: st ? { school_id: st.school_id, grade: st.grade, classroom: st.classroom, has_vehicle: !!st.vehicle_id, is_deleted: !!st.is_deleted } : null,
    destination_code_conflict: !!destDup,
  };
}

// Guard for the affiliation approve/reject routes: the request must be in this
// affiliation AND internal to it. A cross-affiliation request is refused with a
// Thai message naming who decides instead.
async function assertAffiliationCanDecide(pool, { requestId, affiliationId }) {
  const detail = await getDetailForAffiliation(pool, { requestId, affiliationId });
  if (detail.direction !== 'INTERNAL') {
    const e = forbidden('คำขอนี้เป็นการโอนย้ายข้ามสังกัด โรงเรียนปลายทางเป็นผู้พิจารณาอนุมัติหรือไม่อนุมัติ สังกัดดูสถานะได้อย่างเดียว');
    e.errors = [{ code: 'CROSS_AFFILIATION_DESTINATION_SCHOOL_DECIDES' }];
    throw e;
  }
  return detail;
}

// Toast wording for an approve outcome; the approve routes answer 200 for
// every outcome and the client shows non-applied ones as errors (QA affiliation-09).
function approveOutcomeMessage(out) {
  return out.status === 'APPLIED' ? 'อนุมัติและดำเนินการโอนย้ายสำเร็จ'
    : out.status === 'ALREADY_APPLIED' ? 'คำขอนี้ดำเนินการไปแล้ว'
    : out.status === 'FAILED' && out.reason === 'DESTINATION_CODE_EXISTS' ? 'ไม่สามารถโอนย้ายได้ เนื่องจากพบรหัสนักเรียนซ้ำในโรงเรียนปลายทาง'
    : out.status === 'FAILED' && out.reason === 'DESTINATION_MISSING' ? 'ไม่สามารถโอนย้ายได้ เนื่องจากไม่พบโรงเรียนปลายทาง (อาจถูกลบไปแล้ว)'
    : out.status === 'FAILED' && out.reason ? 'ไม่สามารถดำเนินการได้'
    : out.status === 'STALE_NEEDS_REVIEW' ? 'ข้อมูลนักเรียนเปลี่ยนแปลงตั้งแต่ส่งคำขอ กรุณาตรวจสอบใหม่'
    : 'คำขอนี้ไม่อยู่ในสถานะรออนุมัติแล้ว';
}


module.exports = {
  APPROVER, isCrossAffiliation,
  createRequest, listForSchool, cancelRequest, listForAdmin, countPendingForAdmin, getDetailForAdmin,
  listForAffiliation, getDetailForAffiliation, assertAffiliationCanDecide, approveOutcomeMessage,
  getIncomingDetailForSchool, approveAsDestinationSchool, rejectAsDestinationSchool,
  approveAndApply, reject,
};
