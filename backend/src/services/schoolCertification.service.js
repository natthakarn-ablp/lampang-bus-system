'use strict';

/**
 * schoolCertification.service.js — "ล้อที่ 3 ระบบการรับรองรถโรงเรียน" of the มพบ.
 * manual "คู่มือการจัดระบบรถโรงเรียนให้ปลอดภัยและเป็นธรรม" (2564), owner request
 * 2026-11-14. Migration 063, FEATURE_SCHOOL_CERTIFICATION (dark by default).
 *
 * Flow: the school (main account) sets an intake window + criteria for the
 * term → the driver uploads ID card, licence, vehicle photo, registration book
 * (+ พ.ร.บ. when the school asks) and names the in-vehicle caretaker → the
 * school checks the document list and ISSUES "หนังสือรับรองการรับส่งนักเรียน"
 * (cert_no <school id>/<term id>/<0001>, valid to the end of the term) → DLT
 * (transport) inspects only vehicles holding a valid certificate; a pass is
 * capped at the term end; FAILED / NEEDS_FIX get a 15-day fix deadline.
 * Schools may ask transport for one inspection day at the school.
 *
 * Every function here is a no-op / 404 path while the flag is off, and nothing
 * outside this module touches the 063 tables unless enabled() is true.
 * No pupil name or id is stored: the certificate snapshot keeps counts only.
 */

const env = require('../config/env');
const { logAudit } = require('../utils/audit');
const { toBangkokDate, todayBangkok } = require('../utils/thaiTime');
const { getCurrentTerm, getTermEndDate, addCalendarDays } = require('./term.service');

const FIX_DAYS = 15;
const EXPIRING_DAYS = 30;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Application states in which a certificate may be issued from the dedicated
// endpoint (review / ready issue it automatically).
const ISSUABLE_STATUSES = ['READY_TO_PRINT', 'SUBMITTED', 'INSPECTION_PENDING', 'NEEDS_FIX'];
const APPOINTABLE_STATUSES = ['READY_TO_PRINT', 'SUBMITTED', 'NEEDS_FIX'];

function enabled() {
  return env.features.schoolCertification === true;
}

function appError(message, statusCode = 400, code = null, extra = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.errors = [{ code, ...(extra || {}) }];
  return error;
}

function isoDate(value) {
  if (!value) return null;
  if (typeof value === 'string' && DATE_RE.test(value)) return value;
  return toBangkokDate(value);
}

function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86400000);
}

// ─── Pure rules ─────────────────────────────────────────────────────────────

/** <school id>/<term id>/<running 4-digit>, e.g. SCH0001/2569-2/0007. */
function formatCertNo(schoolId, termId, seq) {
  const n = Math.max(1, Number(seq) || 1);
  return `${schoolId}/${termId}/${String(n).padStart(4, '0')}`;
}

/** Running number of a cert_no produced by formatCertNo (0 when unparsable). */
function certSeq(certNo) {
  const last = String(certNo || '').split('/').pop();
  const n = parseInt(last, 10);
  return Number.isFinite(n) ? n : 0;
}

/** NONE | REVOKED | EXPIRED | VALID — and whether it ends within 30 days. */
function certificateState(cert, today = todayBangkok()) {
  if (!cert) return { state: 'NONE', expiring: false };
  if (cert.revoked_at) return { state: 'REVOKED', expiring: false };
  const until = isoDate(cert.valid_until);
  if (!until || until < today) return { state: 'EXPIRED', expiring: false };
  const left = daysBetween(today, until);
  return { state: 'VALID', expiring: left !== null && left <= EXPIRING_DAYS, days_left: left };
}

/** Eligibility reasons contributed by the vehicle's certificate. */
function certificateReasons(cert, today = todayBangkok()) {
  const s = certificateState(cert, today);
  if (s.state === 'NONE') return { reasons: ['CERTIFICATE_MISSING'], expiring: false };
  if (s.state === 'REVOKED') return { reasons: ['CERTIFICATE_REVOKED'], expiring: false };
  if (s.state === 'EXPIRED') return { reasons: ['CERTIFICATE_EXPIRED'], expiring: false };
  return { reasons: [], expiring: s.expiring };
}

/** Of a vehicle's certificates (newest first), the one that governs it. */
function pickGoverningCertificate(certs = [], today = todayBangkok()) {
  if (!certs.length) return null;
  return certs.find((c) => certificateState(c, today).state === 'VALID') || certs[0];
}

/**
 * The DLT permit is valid at most one semester: default to the term end, and
 * refuse a later date. Returns { expiry } or { error: {code,message} }.
 */
function capExpiryToTerm({ expiryDate = null, termEnd }) {
  if (!termEnd) return { expiry: expiryDate || null };
  if (!expiryDate) return { expiry: termEnd };
  if (!DATE_RE.test(String(expiryDate))) {
    return { error: { code: 'EXPIRY_DATE_INVALID', message: 'วันหมดอายุต้องอยู่ในรูปแบบ YYYY-MM-DD' } };
  }
  if (expiryDate > termEnd) {
    return {
      error: {
        code: 'EXPIRY_AFTER_TERM_END',
        message: `ผลตรวจมีอายุไม่เกินหนึ่งภาคเรียน — วันหมดอายุต้องไม่เกิน ${termEnd}`,
        term_end: termEnd,
      },
    };
  }
  return { expiry: expiryDate };
}

/** FAILED / NEEDS_FIX: resubmit within 15 days of the finalize date. */
function fixDeadlineFor(dateIso = todayBangkok()) {
  return addCalendarDays(dateIso, FIX_DAYS);
}

/** True when a FAILED/NEEDS_FIX application's fix deadline has passed. */
function isFixOverdue(app, today = todayBangkok()) {
  if (!app || !['FAILED', 'NEEDS_FIX'].includes(app.status)) return false;
  const d = isoDate(app.fix_deadline);
  return Boolean(d && d < today);
}

/** NOT_SET | BEFORE | OPEN | CLOSED for an intake window. */
function windowState(window, today = todayBangkok()) {
  if (!window || (!window.opens_on && !window.closes_on)) return 'NOT_SET';
  const opens = isoDate(window.opens_on);
  const closes = isoDate(window.closes_on);
  if (opens && today < opens) return 'BEFORE';
  if (closes && today > closes) return 'CLOSED';
  return 'OPEN';
}

function normaliseReason(reason) {
  const r = String(reason || '').trim();
  if (r.length < 5) throw appError('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร', 400, 'REASON_REQUIRED');
  return r.slice(0, 500);
}

function assertEnabled() {
  if (!enabled()) throw appError('Not found', 404, 'FEATURE_DISABLED');
}

// ─── Intake window ──────────────────────────────────────────────────────────

async function getWindow(db, schoolId, termId) {
  const [rows] = await db.query(
    `SELECT school_id, term_id,
            DATE_FORMAT(opens_on, '%Y-%m-%d') AS opens_on,
            DATE_FORMAT(closes_on, '%Y-%m-%d') AS closes_on,
            criteria_note, require_compulsory_insurance, updated_at
       FROM school_certification_windows
      WHERE school_id = ? AND term_id = ?`,
    [schoolId, termId]
  );
  if (!rows.length) return null;
  return { ...rows[0], require_compulsory_insurance: Boolean(rows[0].require_compulsory_insurance) };
}

async function getWindowSummary(db, schoolId) {
  const termId = await getCurrentTerm(db);
  const window = await getWindow(db, schoolId, termId);
  return {
    term_id: termId,
    term_end_date: await getTermEndDate(db, termId),
    window,
    window_state: windowState(window),
  };
}

async function setWindow(pool, {
  schoolId, userId, opensOn = null, closesOn = null, criteriaNote = null,
  requireCompulsoryInsurance = false,
}) {
  if (!schoolId || !userId) throw appError('ไม่พบขอบเขตโรงเรียน', 403, 'SCHOOL_SCOPE_REQUIRED');
  const opens = opensOn ? String(opensOn) : null;
  const closes = closesOn ? String(closesOn) : null;
  if ((opens && !DATE_RE.test(opens)) || (closes && !DATE_RE.test(closes))) {
    throw appError('วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD', 400, 'DATE_INVALID');
  }
  if (opens && closes && opens > closes) {
    throw appError('วันเปิดรับต้องไม่หลังวันปิดรับ', 400, 'WINDOW_RANGE_INVALID');
  }
  const note = criteriaNote == null ? null : String(criteriaNote).trim().slice(0, 2000) || null;
  const termId = await getCurrentTerm(pool);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const before = await getWindow(conn, schoolId, termId);
    await conn.query(
      `INSERT INTO school_certification_windows
         (school_id, term_id, opens_on, closes_on, criteria_note, require_compulsory_insurance, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE opens_on = VALUES(opens_on), closes_on = VALUES(closes_on),
         criteria_note = VALUES(criteria_note),
         require_compulsory_insurance = VALUES(require_compulsory_insurance),
         updated_by = VALUES(updated_by)`,
      [schoolId, termId, opens, closes, note, Boolean(requireCompulsoryInsurance), userId]
    );
    const after = {
      opens_on: opens, closes_on: closes, criteria_note: note,
      require_compulsory_insurance: Boolean(requireCompulsoryInsurance),
    };
    await logAudit({
      userId, action: before ? 'UPDATE' : 'CREATE', entityType: 'school_certification_window',
      entityId: `${schoolId}:${termId}`, oldValue: before, newValue: { term_id: termId, ...after },
      conn, required: true,
    });
    await conn.commit();
    return { term_id: termId, window: { school_id: schoolId, term_id: termId, ...after }, window_state: windowState(after) };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// ─── Document checklist ─────────────────────────────────────────────────────

const DOC_ITEMS = [
  { code: 'ID_CARD', label: 'สำเนาบัตรประจำตัวประชาชนคนขับ', kind: 'driver' },
  { code: 'DRIVER_LICENCE', label: 'สำเนาใบอนุญาตขับขี่', kind: 'driver' },
  { code: 'VEHICLE_PHOTO', label: 'รูปถ่ายรถ', kind: 'vehicle' },
  { code: 'VEHICLE_REGISTRATION', label: 'สำเนาเล่มทะเบียนรถ', kind: 'vehicle' },
  { code: 'COMPULSORY_INSURANCE', label: 'หลักฐาน พ.ร.บ.', kind: 'vehicle', optional: true },
];

async function safeRows(db, sql, params) {
  try {
    const [rows] = await db.query(sql, params);
    return rows;
  } catch { return []; } // 045 document tables absent: report every document missing
}

/**
 * True when a live pupil of `schoolId` rides `vehicleId`. One vehicle often
 * carries pupils of several schools (owner test 2026-11-14: a songthaew with
 * pupils of 3 schools); every such school may SEE the vehicle's certificates,
 * only the issuing school may issue or revoke them.
 */
async function schoolRidesVehicle(db, schoolId, vehicleId) {
  if (!schoolId || !vehicleId) return false;
  const [[row]] = await db.query(
    `SELECT 1 AS ok FROM students
      WHERE vehicle_id = ? AND school_id = ? AND is_deleted = FALSE LIMIT 1`,
    [vehicleId, schoolId]
  );
  return Boolean(row);
}

/** Linked to the application (a rider school when it was filed) or rides the vehicle now. */
async function schoolRelatedToApplication(db, app, schoolId) {
  if (!schoolId) return false;
  const [[link]] = await db.query(
    'SELECT 1 AS ok FROM inspection_application_schools WHERE application_id = ? AND school_id = ? LIMIT 1',
    [app.id, schoolId]
  );
  return Boolean(link) || schoolRidesVehicle(db, schoolId, app.vehicle_id);
}

/**
 * The application as the school sees it for certification. `issuingOnly`
 * requires the caller's school to be the issuing school (issue/revoke paths):
 * another rider school of the same vehicle gets 403 ISSUING_SCHOOL_REQUIRED
 * (it can see the application), an unrelated school 404. Otherwise any
 * related school may read it.
 */
async function loadApplicationForSchool(db, { applicationId, schoolId, issuingOnly = false, lock = false }) {
  const [[app]] = await db.query(
    `SELECT a.id, a.request_no, a.status, a.vehicle_id, a.issuing_school_id, a.requested_by,
            a.current_term, v.plate_no, v.vehicle_type, v.caretaker_name, v.caretaker_phone,
            sc.name AS issuing_school_name
       FROM vehicle_inspection_applications a
       JOIN vehicles v ON v.id = a.vehicle_id
       JOIN schools sc ON sc.id = a.issuing_school_id
      WHERE a.id = ?
      ${lock ? 'FOR UPDATE' : ''}`,
    [applicationId]
  );
  const notFound = () => appError('ไม่พบคำขอ หรือคุณไม่มีสิทธิ์ดูคำขอนี้', 404, 'APPLICATION_NOT_FOUND');
  if (!app) throw notFound();
  if (String(app.issuing_school_id) === String(schoolId)) return app;
  const related = await schoolRelatedToApplication(db, app, schoolId);
  if (!related) throw notFound(); // another school's vehicle: answer as for a missing row
  if (issuingOnly) {
    throw appError(
      `เฉพาะโรงเรียนผู้ออกหนังสือรับรอง (${app.issuing_school_name || app.issuing_school_id}) เท่านั้นที่ออกหรือเพิกถอนได้`,
      403, 'ISSUING_SCHOOL_REQUIRED', { issuing_school_id: app.issuing_school_id }
    );
  }
  return app;
}

/** Driver behind the application: the submitting driver account, else the vehicle's active driver. */
async function resolveDriver(db, app) {
  const [[byUser]] = await db.query(
    `SELECT d.id AS driver_id, d.name AS driver_name
       FROM users u JOIN drivers d ON d.id = u.driver_id AND d.is_deleted = FALSE
      WHERE u.id = ? AND u.role = 'driver' LIMIT 1`,
    [app.requested_by]
  );
  if (byUser) return byUser;
  const [[byVehicle]] = await db.query(
    `SELECT d.id AS driver_id, d.name AS driver_name
       FROM driver_vehicle_assignments dva
       JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
      WHERE dva.vehicle_id = ? AND dva.is_active = TRUE
      ORDER BY FIELD(dva.assignment_role, 'PRIMARY', 'BACKUP'), dva.id
      LIMIT 1`,
    [app.vehicle_id]
  );
  return byVehicle || null;
}

/** Pure: build the checklist rows from loaded facts. */
function buildChecklistItems({ vehicleDocs = [], driverDocs = [], requireCompulsoryInsurance = false, pupilCount = 0, caretaker = {} }) {
  const latest = (docs, type) => docs
    .filter((d) => d.doc_type === type && d.review_status !== 'REJECTED')
    .sort((a, b) => Number(b.id) - Number(a.id))[0] || null;
  const items = DOC_ITEMS
    .filter((i) => !i.optional || requireCompulsoryInsurance)
    .map((i) => {
      const doc = latest(i.kind === 'driver' ? driverDocs : vehicleDocs, i.code);
      return {
        code: i.code, label: i.label, kind: i.kind, required: true, present: Boolean(doc),
        document_id: doc ? doc.id : null, review_status: doc ? doc.review_status : null,
      };
    });
  items.push({
    code: 'PUPIL_LIST', label: 'รายชื่อนักเรียนที่รับส่ง (จากระบบ)', kind: 'system', required: true,
    present: pupilCount > 0, count: pupilCount,
  });
  const hasCaretaker = Boolean(String(caretaker.name || '').trim() && String(caretaker.phone || '').trim());
  items.push({
    code: 'CARETAKER', label: 'ผู้ดูแลนักเรียนประจำรถ (ชื่อ/เบอร์โทร)', kind: 'vehicle', required: true,
    present: hasCaretaker, name: caretaker.name || null, phone: caretaker.phone || null,
  });
  return items;
}

async function getDocumentChecklist(db, { applicationId, schoolId, app = null }) {
  const application = app || await loadApplicationForSchool(db, { applicationId, schoolId });
  const termId = await getCurrentTerm(db);
  const window = await getWindow(db, application.issuing_school_id, termId);
  const driver = await resolveDriver(db, application);
  const vehicleDocs = await safeRows(db,
    `SELECT id, doc_type, review_status FROM vehicle_documents
      WHERE vehicle_id = ? AND is_deleted = FALSE`, [application.vehicle_id]);
  const driverDocs = driver ? await safeRows(db,
    `SELECT id, doc_type, review_status FROM driver_documents
      WHERE driver_id = ? AND is_deleted = FALSE`, [driver.driver_id]) : [];
  // Pupils per school on this vehicle (counts and school names only). The
  // PUPIL_LIST item counts the issuing school's own pupils, whoever is looking.
  const [pupilRows] = await db.query(
    `SELECT s.school_id, sc.name AS school_name, COUNT(*) AS n
       FROM students s
       JOIN schools sc ON sc.id = s.school_id
      WHERE s.vehicle_id = ? AND s.is_deleted = FALSE
      GROUP BY s.school_id, sc.name
      ORDER BY sc.name`,
    [application.vehicle_id]
  );
  const pupilsBySchool = (pupilRows || []).map((r) => ({
    school_id: r.school_id, school_name: r.school_name, pupil_count: Number(r.n) || 0,
  }));
  const own = pupilsBySchool.find((r) => String(r.school_id) === String(application.issuing_school_id));
  const totalPupils = pupilsBySchool.reduce((sum, r) => sum + r.pupil_count, 0);
  const items = buildChecklistItems({
    vehicleDocs, driverDocs,
    requireCompulsoryInsurance: Boolean(window && window.require_compulsory_insurance),
    pupilCount: own ? own.pupil_count : 0,
    caretaker: { name: application.caretaker_name, phone: application.caretaker_phone },
  });
  const pupilItem = items.find((i) => i.code === 'PUPIL_LIST');
  if (pupilItem) {
    pupilItem.total_count = totalPupils;
    pupilItem.schools = pupilsBySchool;
  }
  const state = windowState(window);
  return {
    application: {
      id: application.id, request_no: application.request_no, status: application.status,
      vehicle_id: application.vehicle_id, plate_no: application.plate_no,
      vehicle_type: application.vehicle_type, issuing_school_id: application.issuing_school_id,
      issuing_school_name: application.issuing_school_name,
    },
    driver,
    term_id: termId,
    term_end_date: await getTermEndDate(db, termId),
    window,
    window_state: state,
    outside_window: state === 'BEFORE' || state === 'CLOSED',
    items,
    missing: items.filter((i) => i.required && !i.present).map((i) => i.code),
    certificate: await latestCertificateForApplication(db, application.id),
    // Every other rider school of a shared vehicle reads this, read-only.
    viewer_is_issuer: !schoolId || String(schoolId) === String(application.issuing_school_id),
    // The same vehicle's certificates from the other rider schools (latest per school).
    other_school_certificates: await otherSchoolCertificates(db, application.vehicle_id, application.issuing_school_id),
  };
}

/** Latest certificate per school for a vehicle, excluding `exceptSchoolId`. */
async function otherSchoolCertificates(db, vehicleId, exceptSchoolId) {
  const [rows] = await db.query(
    `SELECT c.id, c.cert_no, c.school_id, sc.name AS school_name, c.term_id,
            DATE_FORMAT(c.valid_until, '%Y-%m-%d') AS valid_until, c.revoked_at, c.revoke_reason
       FROM school_transport_certificates c
       JOIN schools sc ON sc.id = c.school_id
      WHERE c.vehicle_id = ? AND c.school_id <> ?
      ORDER BY c.id DESC LIMIT 50`,
    [vehicleId, exceptSchoolId]
  );
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    if (seen.has(String(r.school_id))) continue;
    seen.add(String(r.school_id));
    const st = certificateState(r);
    out.push({ ...r, state: st.state, expiring: st.expiring });
  }
  return out;
}

// ─── Certificates ───────────────────────────────────────────────────────────

const CERT_COLUMNS = `c.id, c.cert_no, c.application_id, c.vehicle_id, c.school_id, c.driver_id,
  c.term_id, c.issued_at, DATE_FORMAT(c.valid_until, '%Y-%m-%d') AS valid_until, c.issued_by,
  c.revoked_at, c.revoked_by, c.revoke_reason, c.snapshot_json`;

function mapCertificate(row, today = todayBangkok()) {
  if (!row) return null;
  let snapshot = row.snapshot_json;
  if (typeof snapshot === 'string') { try { snapshot = JSON.parse(snapshot); } catch { snapshot = null; } }
  const out = { ...row, snapshot: snapshot || null };
  delete out.snapshot_json;
  const s = certificateState(row, today);
  out.state = s.state;
  out.expiring = s.expiring;
  return out;
}

async function latestCertificateForApplication(db, applicationId) {
  const [rows] = await db.query(
    `SELECT ${CERT_COLUMNS} FROM school_transport_certificates c
      WHERE c.application_id = ? ORDER BY c.id DESC LIMIT 1`,
    [applicationId]
  );
  return mapCertificate(rows[0] || null);
}

async function validCertificateForApplication(db, applicationId, today = todayBangkok()) {
  const [rows] = await db.query(
    `SELECT ${CERT_COLUMNS} FROM school_transport_certificates c
      WHERE c.application_id = ? AND c.revoked_at IS NULL AND c.valid_until >= ?
      ORDER BY c.id DESC LIMIT 1`,
    [applicationId, today]
  );
  return mapCertificate(rows[0] || null, today);
}

/** The certificate that governs a vehicle's eligibility (see pickGoverningCertificate). */
async function governingCertificateForVehicle(db, vehicleId, today = todayBangkok()) {
  const [rows] = await db.query(
    `SELECT ${CERT_COLUMNS} FROM school_transport_certificates c
      WHERE c.vehicle_id = ? ORDER BY c.id DESC LIMIT 20`,
    [vehicleId]
  );
  return pickGoverningCertificate(rows, today);
}

/** Latest certificate per application id, for queue/list rows. */
async function certificatesByApplication(db, applicationIds = []) {
  const ids = [...new Set(applicationIds.map(Number).filter(Boolean))];
  if (!ids.length) return new Map();
  const [rows] = await db.query(
    `SELECT ${CERT_COLUMNS} FROM school_transport_certificates c
      WHERE c.application_id IN (?) ORDER BY c.id DESC`,
    [ids]
  );
  const map = new Map();
  for (const r of rows) if (!map.has(Number(r.application_id))) map.set(Number(r.application_id), mapCertificate(r));
  return map;
}

/**
 * Issue a certificate for an application inside the caller's transaction.
 * Idempotent: an existing valid certificate is returned as is. The running
 * number is taken under a lock on the school row so two issues cannot share it.
 */
async function issueCertificateInTx(conn, { applicationId, schoolId, userId }) {
  const today = todayBangkok();
  const existing = await validCertificateForApplication(conn, applicationId, today);
  if (existing) return { certificate: existing, created: false, warnings: [] };

  const app = await loadApplicationForSchool(conn, { applicationId, schoolId, issuingOnly: true });
  const checklist = await getDocumentChecklist(conn, { applicationId, schoolId, app });
  const termId = checklist.term_id;
  const validUntil = checklist.term_end_date;
  if (!validUntil) throw appError('ไม่พบวันสิ้นภาคเรียน', 422, 'TERM_END_UNKNOWN');

  await conn.query('SELECT id FROM schools WHERE id = ? FOR UPDATE', [schoolId]);
  const [seqRows] = await conn.query(
    'SELECT cert_no FROM school_transport_certificates WHERE school_id = ? AND term_id = ?',
    [schoolId, termId]
  );
  const next = seqRows.reduce((m, r) => Math.max(m, certSeq(r.cert_no)), 0) + 1;
  const certNo = formatCertNo(schoolId, termId, next);
  const pupilItem = checklist.items.find((i) => i.code === 'PUPIL_LIST');
  const snapshot = {
    pupil_count: pupilItem ? pupilItem.count : 0,
    // Shared vehicle: every rider school's count (school names, never pupils).
    total_pupil_count: pupilItem && pupilItem.total_count != null ? pupilItem.total_count : (pupilItem ? pupilItem.count : 0),
    school_count: pupilItem && pupilItem.schools ? pupilItem.schools.length : 1,
    schools: pupilItem && pupilItem.schools
      ? pupilItem.schools.map((r) => ({ school_name: r.school_name, pupil_count: r.pupil_count })) : [],
    caretaker_name: app.caretaker_name || null,
    caretaker_phone: app.caretaker_phone || null,
    plate_no: app.plate_no,
    vehicle_type: app.vehicle_type,
    driver_name: checklist.driver ? checklist.driver.driver_name : null,
    school_name: app.issuing_school_name,
    documents: checklist.items.map((i) => ({ code: i.code, present: i.present })),
    window_state: checklist.window_state,
  };
  const [ins] = await conn.query(
    `INSERT INTO school_transport_certificates
       (cert_no, application_id, vehicle_id, school_id, driver_id, term_id, valid_until, issued_by, snapshot_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [certNo, applicationId, app.vehicle_id, schoolId,
      checklist.driver ? checklist.driver.driver_id : null, termId, validUntil, userId, JSON.stringify(snapshot)]
  );
  const warnings = [];
  if (checklist.outside_window) warnings.push('OUTSIDE_WINDOW');
  if (checklist.missing.length) warnings.push('DOCUMENTS_MISSING');
  // Another rider school revoked its certificate for this vehicle this term:
  // still issued (each school answers for its own pupils), but say so.
  if ((checklist.other_school_certificates || [])
    .some((c) => c.state === 'REVOKED' && String(c.term_id) === String(termId))) {
    warnings.push('REVOKED_BY_OTHER_SCHOOL');
  }
  await logAudit({
    userId, action: 'CREATE', entityType: 'school_transport_certificate', entityId: String(ins.insertId),
    newValue: {
      cert_no: certNo, application_id: Number(applicationId), vehicle_id: app.vehicle_id,
      term_id: termId, valid_until: validUntil, missing: checklist.missing, warnings,
    },
    conn, required: true,
  });
  const [[row]] = await conn.query(
    `SELECT ${CERT_COLUMNS} FROM school_transport_certificates c WHERE c.id = ?`, [ins.insertId]);
  return { certificate: mapCertificate(row || { id: ins.insertId, cert_no: certNo, valid_until: validUntil }), created: true, warnings, missing: checklist.missing };
}

/** POST /school/applications/:id/certificate — issue for an application already past review. */
async function issueCertificate(pool, { applicationId, schoolId, userId }) {
  assertEnabled();
  if (!schoolId || !userId) throw appError('ไม่พบขอบเขตโรงเรียน', 403, 'SCHOOL_SCOPE_REQUIRED');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const app = await loadApplicationForSchool(conn, { applicationId, schoolId, issuingOnly: true, lock: true });
    if (!ISSUABLE_STATUSES.includes(app.status)) {
      throw appError('ออกหนังสือรับรองได้เมื่อคำขอผ่านการตรวจเอกสารแล้วและยังไม่สรุปผล', 409,
        'INVALID_APPLICATION_STATUS', { current_status: app.status });
    }
    const out = await issueCertificateInTx(conn, { applicationId, schoolId, userId });
    await conn.commit();
    await refreshEligibilityQuietly(pool, app.vehicle_id);
    return out;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function refreshEligibilityQuietly(pool, vehicleId) {
  try {
    // Lazy: vehicleVerification.service requires this module.
    const { refreshVehicleEligibility } = require('./vehicleVerification.service');
    await refreshVehicleEligibility(pool, vehicleId);
  } catch { /* eligibility is recomputed on the next inspection event */ }
}

async function revokeCertificate(pool, { certificateId, schoolId, userId, reason }) {
  assertEnabled();
  const why = normaliseReason(reason);
  if (!schoolId || !userId) throw appError('ไม่พบขอบเขตโรงเรียน', 403, 'SCHOOL_SCOPE_REQUIRED');
  const conn = await pool.getConnection();
  let vehicleId = null;
  try {
    await conn.beginTransaction();
    const [[cert]] = await conn.query(
      `SELECT id, cert_no, school_id, vehicle_id, revoked_at FROM school_transport_certificates
        WHERE id = ? FOR UPDATE`, [certificateId]);
    if (!cert) throw appError('ไม่พบหนังสือรับรอง', 404, 'CERTIFICATE_NOT_FOUND');
    if (String(cert.school_id) !== String(schoolId)) {
      // A rider school of a shared vehicle sees the certificate but cannot revoke it.
      if (await schoolRidesVehicle(conn, schoolId, cert.vehicle_id)) {
        throw appError('เฉพาะโรงเรียนผู้ออกหนังสือรับรองเท่านั้นที่เพิกถอนได้', 403, 'ISSUING_SCHOOL_REQUIRED');
      }
      throw appError('ไม่พบหนังสือรับรอง', 404, 'CERTIFICATE_NOT_FOUND');
    }
    if (cert.revoked_at) throw appError('หนังสือรับรองนี้ถูกเพิกถอนแล้ว', 409, 'CERTIFICATE_ALREADY_REVOKED');
    await conn.query(
      `UPDATE school_transport_certificates
          SET revoked_at = CURRENT_TIMESTAMP, revoked_by = ?, revoke_reason = ?
        WHERE id = ? AND revoked_at IS NULL`,
      [userId, why, certificateId]
    );
    await logAudit({
      userId, action: 'UPDATE', entityType: 'school_transport_certificate', entityId: String(certificateId),
      oldValue: { revoked: false }, newValue: { revoked: true, reason: why, cert_no: cert.cert_no },
      conn, required: true,
    });
    await conn.commit();
    vehicleId = cert.vehicle_id;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  await refreshEligibilityQuietly(pool, vehicleId);
  return { id: Number(certificateId), revoked: true };
}

/**
 * The certificates a school sees: those it issued, plus (read-only) those
 * other schools issued for a vehicle its own pupils ride now (shared vehicle).
 * `is_issuer` tells the two apart; only the issuer may revoke.
 */
async function listSchoolCertificates(db, { schoolId }) {
  const [rows] = await db.query(
    `SELECT ${CERT_COLUMNS}, v.plate_no, a.request_no, a.status AS application_status,
            sc.name AS school_name
       FROM school_transport_certificates c
       JOIN vehicles v ON v.id = c.vehicle_id
       JOIN vehicle_inspection_applications a ON a.id = c.application_id
       JOIN schools sc ON sc.id = c.school_id
      WHERE c.school_id = ?
         OR EXISTS (SELECT 1 FROM students s
                     WHERE s.vehicle_id = c.vehicle_id AND s.school_id = ? AND s.is_deleted = FALSE)
      ORDER BY (c.school_id = ?) DESC, c.id DESC LIMIT 500`,
    [schoolId, schoolId, schoolId]
  );
  return rows.map((r) => ({ ...mapCertificate(r), is_issuer: String(r.school_id) === String(schoolId) }));
}

async function listVehicleCertificates(db, { vehicleId }) {
  const [rows] = await db.query(
    `SELECT ${CERT_COLUMNS}, sc.name AS school_name
       FROM school_transport_certificates c
       JOIN schools sc ON sc.id = c.school_id
      WHERE c.vehicle_id = ?
      ORDER BY c.id DESC LIMIT 50`,
    [vehicleId]
  );
  return rows.map((r) => mapCertificate(r));
}

/**
 * One certificate for printing. school: own, or one for a vehicle its pupils
 * ride (shared vehicle, read-only); driver: a certificate of the
 * vehicle they drive (driverVehicleId) or of an application they submitted;
 * transport/admin: any. Everything else answers 404.
 */
async function getCertificateForViewer(db, { certificateId, viewer, driverVehicleId = null }) {
  const [[row]] = await db.query(
    `SELECT ${CERT_COLUMNS}, v.plate_no, v.vehicle_type, sc.name AS school_name,
            a.request_no, a.requested_by, d.name AS driver_name
       FROM school_transport_certificates c
       JOIN vehicles v ON v.id = c.vehicle_id
       JOIN schools sc ON sc.id = c.school_id
       JOIN vehicle_inspection_applications a ON a.id = c.application_id
       LEFT JOIN drivers d ON d.id = c.driver_id
      WHERE c.id = ?`,
    [certificateId]
  );
  const notFound = () => appError('ไม่พบหนังสือรับรอง', 404, 'CERTIFICATE_NOT_FOUND');
  if (!row) throw notFound();
  const role = viewer && viewer.role;
  if (role === 'school') {
    if (viewer.gradeScope || !viewer.schoolId) throw notFound();
    // Own certificate, or (read-only) one for a vehicle the school's pupils ride.
    if (String(row.school_id) !== String(viewer.schoolId)
      && !await schoolRidesVehicle(db, viewer.schoolId, row.vehicle_id)) throw notFound();
  } else if (role === 'driver') {
    const own = String(row.requested_by) === String(viewer.userId)
      || (driverVehicleId && String(row.vehicle_id) === String(driverVehicleId));
    if (!own) throw notFound();
  } else if (!['transport', 'admin'].includes(role)) {
    throw notFound();
  }
  return mapCertificate(row);
}

// ─── Caretaker (ผู้ดูแลนักเรียน) ─────────────────────────────────────────────

const PHONE_RE = /^0\d{8,9}$/;

async function getCaretaker(db, vehicleId) {
  const [[row]] = await db.query(
    'SELECT caretaker_name, caretaker_phone FROM vehicles WHERE id = ? AND is_deleted = FALSE', [vehicleId]);
  return row ? { name: row.caretaker_name || null, phone: row.caretaker_phone || null } : null;
}

async function setCaretaker(pool, { vehicleId, userId, name, phone }) {
  assertEnabled();
  if (!vehicleId) throw appError('ไม่พบรถที่ผูกกับบัญชีคนขับ', 400, 'NO_VEHICLE');
  const n = String(name || '').trim();
  const p = String(phone || '').replace(/[\s-]/g, '');
  if (n.length > 150) throw appError('ชื่อผู้ดูแลยาวเกินไป', 400, 'CARETAKER_NAME_TOO_LONG');
  if (n && !p) throw appError('กรุณากรอกเบอร์โทรผู้ดูแล', 400, 'CARETAKER_PHONE_REQUIRED');
  if (p && !PHONE_RE.test(p)) throw appError('เบอร์โทรผู้ดูแลไม่ถูกต้อง (ตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0)', 400, 'CARETAKER_PHONE_INVALID');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[v]] = await conn.query(
      'SELECT id, caretaker_name FROM vehicles WHERE id = ? AND is_deleted = FALSE FOR UPDATE', [vehicleId]);
    if (!v) throw appError('ไม่พบรถ', 404, 'VEHICLE_NOT_FOUND');
    await conn.query('UPDATE vehicles SET caretaker_name = ?, caretaker_phone = ? WHERE id = ?',
      [n || null, n ? p : null, vehicleId]);
    // The phone is personal data: the audit row records that one was set, not the number.
    await logAudit({
      userId, action: 'UPDATE', entityType: 'vehicle_caretaker', entityId: String(vehicleId),
      oldValue: { caretaker_name: v.caretaker_name || null },
      newValue: { caretaker_name: n || null, has_phone: Boolean(n && p) }, conn, required: true,
    });
    await conn.commit();
    return { vehicle_id: vehicleId, name: n || null, phone: n ? p : null };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// ─── Inspection-day appointments ────────────────────────────────────────────

async function attachAppointmentVehicles(db, appointments) {
  if (!appointments.length) return appointments;
  const [links] = await db.query(
    `SELECT iav.appointment_id, a.id AS application_id, a.request_no, a.status, v.plate_no, v.vehicle_type
       FROM inspection_appointment_vehicles iav
       JOIN vehicle_inspection_applications a ON a.id = iav.application_id
       JOIN vehicles v ON v.id = a.vehicle_id
      WHERE iav.appointment_id IN (?)
      ORDER BY v.plate_no`,
    [appointments.map((a) => a.id)]
  );
  return appointments.map((a) => ({
    ...a,
    vehicles: links.filter((l) => String(l.appointment_id) === String(a.id))
      .map(({ appointment_id: _ignored, ...rest }) => rest),
  }));
}

const APPOINTMENT_COLUMNS = `ap.id, ap.school_id, sc.name AS school_name, ap.term_id,
  DATE_FORMAT(ap.proposed_date, '%Y-%m-%d') AS proposed_date, ap.note, ap.status,
  DATE_FORMAT(ap.confirmed_date, '%Y-%m-%d') AS confirmed_date, ap.confirmed_by,
  ap.created_by, ap.created_at, ap.updated_at`;

async function listAppointments(db, { schoolId = null, status = null } = {}) {
  const where = [];
  const params = [];
  if (schoolId) { where.push('ap.school_id = ?'); params.push(schoolId); }
  if (status) { where.push('ap.status = ?'); params.push(status); }
  const [rows] = await db.query(
    `SELECT ${APPOINTMENT_COLUMNS}
       FROM inspection_appointments ap
       JOIN schools sc ON sc.id = ap.school_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY FIELD(ap.status, 'REQUESTED', 'CONFIRMED', 'DONE', 'CANCELLED'),
               COALESCE(ap.confirmed_date, ap.proposed_date) ASC, ap.id DESC
      LIMIT 300`,
    params
  );
  return attachAppointmentVehicles(db, rows);
}

async function createAppointment(pool, { schoolId, userId, proposedDate, note = null, applicationIds = [] }) {
  assertEnabled();
  if (!schoolId || !userId) throw appError('ไม่พบขอบเขตโรงเรียน', 403, 'SCHOOL_SCOPE_REQUIRED');
  if (!proposedDate || !DATE_RE.test(String(proposedDate))) {
    throw appError('กรุณาระบุวันที่เสนอ (YYYY-MM-DD)', 400, 'PROPOSED_DATE_REQUIRED');
  }
  if (String(proposedDate) < todayBangkok()) throw appError('วันที่เสนอต้องไม่เป็นวันที่ผ่านมาแล้ว', 400, 'PROPOSED_DATE_PAST');
  const ids = [...new Set((Array.isArray(applicationIds) ? applicationIds : []).map(Number).filter((n) => n > 0))];
  if (!ids.length) throw appError('กรุณาเลือกรถอย่างน้อย 1 คัน', 400, 'APPLICATIONS_REQUIRED');
  if (ids.length > 100) throw appError('เลือกได้ไม่เกิน 100 คันต่อการนัด', 400, 'TOO_MANY_APPLICATIONS');
  const termId = await getCurrentTerm(pool);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [apps] = await conn.query(
      `SELECT id, status, issuing_school_id FROM vehicle_inspection_applications
        WHERE id IN (?) FOR UPDATE`, [ids]);
    const bad = ids.filter((id) => {
      const a = apps.find((r) => Number(r.id) === id);
      return !a || String(a.issuing_school_id) !== String(schoolId);
    });
    if (bad.length) throw appError('มีคำขอที่ไม่ใช่ของโรงเรียนนี้', 404, 'APPLICATION_NOT_FOUND', { application_ids: bad });
    const notReady = apps.filter((a) => !APPOINTABLE_STATUSES.includes(a.status)).map((a) => Number(a.id));
    if (notReady.length) {
      throw appError('นัดตรวจได้เฉพาะคำขอที่พร้อมตรวจ', 409, 'APPLICATION_NOT_READY', { application_ids: notReady });
    }
    const [ins] = await conn.query(
      `INSERT INTO inspection_appointments (school_id, term_id, proposed_date, note, status, created_by)
       VALUES (?, ?, ?, ?, 'REQUESTED', ?)`,
      [schoolId, termId, proposedDate, note ? String(note).trim().slice(0, 500) : null, userId]
    );
    for (const id of ids) {
      await conn.query('INSERT INTO inspection_appointment_vehicles (appointment_id, application_id) VALUES (?, ?)',
        [ins.insertId, id]);
    }
    await logAudit({
      userId, action: 'CREATE', entityType: 'inspection_appointment', entityId: String(ins.insertId),
      newValue: { school_id: schoolId, term_id: termId, proposed_date: proposedDate, application_ids: ids },
      conn, required: true,
    });
    await conn.commit();
    return { id: ins.insertId, status: 'REQUESTED', proposed_date: proposedDate, application_ids: ids };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function transitionAppointment(pool, {
  appointmentId, userId, from, to, guard = null, set = {}, auditExtra = {},
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[ap]] = await conn.query(
      'SELECT id, school_id, status FROM inspection_appointments WHERE id = ? FOR UPDATE', [appointmentId]);
    if (!ap) throw appError('ไม่พบการนัดตรวจ', 404, 'APPOINTMENT_NOT_FOUND');
    if (guard) guard(ap);
    if (!from.includes(ap.status)) {
      throw appError('สถานะการนัดปัจจุบันไม่อนุญาตให้ทำรายการนี้', 409, 'INVALID_APPOINTMENT_STATUS', { current_status: ap.status });
    }
    const cols = Object.keys(set);
    await conn.query(
      `UPDATE inspection_appointments SET status = ?${cols.map((c) => `, ${c} = ?`).join('')} WHERE id = ?`,
      [to, ...cols.map((c) => set[c]), appointmentId]
    );
    await logAudit({
      userId, action: 'UPDATE', entityType: 'inspection_appointment', entityId: String(appointmentId),
      oldValue: { status: ap.status }, newValue: { status: to, ...set, ...auditExtra }, conn, required: true,
    });
    await conn.commit();
    return { id: Number(appointmentId), status: to, ...set };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function cancelAppointment(pool, { appointmentId, schoolId, userId }) {
  assertEnabled();
  return transitionAppointment(pool, {
    appointmentId, userId, from: ['REQUESTED', 'CONFIRMED'], to: 'CANCELLED',
    guard: (ap) => {
      if (String(ap.school_id) !== String(schoolId)) throw appError('ไม่พบการนัดตรวจ', 404, 'APPOINTMENT_NOT_FOUND');
    },
  });
}

/** Transport only (route-enforced): fix the inspection day at the school. */
async function confirmAppointment(pool, { appointmentId, userId, confirmedDate }) {
  assertEnabled();
  if (!confirmedDate || !DATE_RE.test(String(confirmedDate))) {
    throw appError('กรุณาเลือกวันตรวจ (YYYY-MM-DD)', 400, 'CONFIRMED_DATE_REQUIRED');
  }
  if (String(confirmedDate) < todayBangkok()) throw appError('วันตรวจต้องไม่เป็นวันที่ผ่านมาแล้ว', 400, 'CONFIRMED_DATE_PAST');
  return transitionAppointment(pool, {
    appointmentId, userId, from: ['REQUESTED', 'CONFIRMED'], to: 'CONFIRMED',
    set: { confirmed_date: confirmedDate, confirmed_by: userId },
  });
}

async function markAppointmentDone(pool, { appointmentId, userId }) {
  assertEnabled();
  return transitionAppointment(pool, { appointmentId, userId, from: ['CONFIRMED'], to: 'DONE' });
}

module.exports = {
  FIX_DAYS,
  EXPIRING_DAYS,
  DOC_ITEMS,
  enabled,
  appError,
  formatCertNo,
  certSeq,
  certificateState,
  certificateReasons,
  pickGoverningCertificate,
  capExpiryToTerm,
  fixDeadlineFor,
  isFixOverdue,
  windowState,
  buildChecklistItems,
  getWindow,
  getWindowSummary,
  setWindow,
  getDocumentChecklist,
  schoolRidesVehicle,
  otherSchoolCertificates,
  latestCertificateForApplication,
  validCertificateForApplication,
  governingCertificateForVehicle,
  certificatesByApplication,
  issueCertificateInTx,
  issueCertificate,
  revokeCertificate,
  listSchoolCertificates,
  listVehicleCertificates,
  getCertificateForViewer,
  getCaretaker,
  setCaretaker,
  listAppointments,
  createAppointment,
  cancelAppointment,
  confirmAppointment,
  markAppointmentDone,
};
