'use strict';

/**
 * certThreeSchoolScenario.test.js — INTEGRATION (disposable lampang_bus_test DB).
 *
 * Owner request 2026-11-14: "ลองทดสอบดูว่าใช้งานจากแผนผังได้มั้ย โดยใช้รหัสทดลอง
 * สมมุติรถรับส่งนักเรียนรับนักเรียน 3 โรงเรียน". The มพบ. 2564 "ล้อที่ 3"
 * certification flowchart (migration 063, FEATURE_SCHOOL_CERTIFICATION),
 * end to end, for ONE songthaew carrying pupils of three schools:
 *   A = issuing school, B = same affiliation, C = another affiliation.
 * HTTP (real routes + JWT) wherever a role boundary is tested; services where
 * only the rule is. All fixtures are fake (__C3*), removed afterwards; LINE is
 * mocked and must never be called.
 *
 * tests/schema.sql has no 045 document tables and no checklist seed: the
 * tables (with 063's doc types) and checklist version 2 are created here only
 * when missing, and dropped/removed again afterwards.
 */

require('./loadTestEnv');

jest.mock('../src/services/line.service');
jest.mock('../src/services/lineDispatch.service');

const request = require('supertest');
const bcrypt = require('bcrypt');
const { getTestConnection } = require('./dbHelper');
const env = require('../src/config/env');
const app = require('../src/app');
const { pool } = require('../src/config/database');
const verification = require('../src/services/vehicleVerification.service');
const docs = require('../src/services/driverDocuments.service');
const pending = require('../src/services/pendingQueue.service');
const term = require('../src/services/term.service');
const lineSvc = require('../src/services/line.service');
const lineDispatch = require('../src/services/lineDispatch.service');
const { todayBangkok } = require('../src/utils/thaiTime');

const AFF_C = '__C3AFF';
const SA = '__C3A';
const SB = '__C3B';
const SC = '__C3C';
const V1 = 'V-c3songthaew';
const V2 = 'V-c3van00002';
const PLATE1 = '__C3 สองแถว 1';
const PLATE2 = '__C3 VAN 2';
const PASSWORD = 'C3-Scenario#2569';
const STUDENTS = { [SA]: [99301, 99302, 99303, 99304], [SB]: [99305, 99306, 99307], [SC]: [99308, 99309] };
const V2_STUDENT = 99310;
const USERNAMES = ['__c3_school_a', '__c3_school_b', '__c3_school_c', '__c3_teacher_a', '__c3_transport', PLATE1];

const ids = {};
const tok = {};
let flagBefore;
let docFlagBefore;
let createdDocTables = false;
let createdTemplate = false;
let templateId = null;
let auditMarker = 0;

async function q(sql, params = []) {
  const conn = await getTestConnection();
  try { return (await conn.query(sql, params))[0]; } finally { await conn.end(); }
}

async function login(username) {
  const res = await request(app).post('/api/auth/login').send({ username, password: PASSWORD });
  if (!res.body?.data?.access_token) throw new Error(`login ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data.access_token;
}

const as = (who, req) => req.set('Authorization', `Bearer ${tok[who]}`);
const get = (who, url) => as(who, request(app).get(url));
const post = (who, url, body = {}) => as(who, request(app).post(url)).send(body);
const put = (who, url, body = {}) => as(who, request(app).put(url)).send(body);

async function tableExists(name) {
  const rows = await q('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [name]);
  return rows.length > 0;
}

async function ensureDocTables() {
  if (await tableExists('vehicle_documents') && await tableExists('driver_documents')) return;
  createdDocTables = true;
  const cols = `storage_key VARCHAR(255) NOT NULL, original_name VARCHAR(255) NOT NULL, mime_type VARCHAR(120) NULL,
    sha256 CHAR(64) NOT NULL, file_size INT NOT NULL, expiry_date DATE NULL, uploaded_by INT NOT NULL,
    review_status ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING', reviewed_by INT NULL,
    reviewed_at TIMESTAMP NULL, review_note VARCHAR(500) NULL, is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMP NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`;
  await q(`CREATE TABLE IF NOT EXISTS vehicle_documents (id BIGINT AUTO_INCREMENT PRIMARY KEY,
    vehicle_id VARCHAR(20) NOT NULL,
    doc_type ENUM('VEHICLE_REGISTRATION','COMPULSORY_INSURANCE','TAX','INSURANCE','OTHER','VEHICLE_PHOTO') NOT NULL,
    ${cols}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await q(`CREATE TABLE IF NOT EXISTS driver_documents (id BIGINT AUTO_INCREMENT PRIMARY KEY,
    driver_id INT NOT NULL, doc_type ENUM('DRIVER_LICENCE','OTHER','ID_CARD') NOT NULL,
    ${cols}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

/** Checklist version 2 as migration 063 seeds it (only when the DB has none). */
async function ensureChecklistV2() {
  const rows = await q("SELECT id FROM inspection_checklist_templates WHERE template_code = 'LAMPANG_SCHOOLBUS' AND version_no = 2");
  if (rows.length) { templateId = rows[0].id; return; }
  createdTemplate = true;
  templateId = (await q(
    `INSERT INTO inspection_checklist_templates (template_code, template_name, version_no, is_active)
     VALUES ('LAMPANG_SCHOOLBUS', '__c3 fixture (มพบ. 2564)', 2, TRUE)`)).insertId;
  const seed = [
    ['SCHOOLBUS_SIGN_LIGHT', 'ป้ายรถโรงเรียนพื้นส้มอักษรดำ และไฟเหลืองอำพัน', false, 'CRITICAL', 100],
    ['NO_TINT', 'ไม่ติดฟิล์มกรองแสง', false, 'MAJOR', 110],
    ['NO_STANDING', 'ไม่มีที่ยืนในห้องโดยสาร', false, 'CRITICAL', 120],
    ['REAR_GUARD', 'รถสองแถวขึ้นลงท้าย มีประตู/ที่กั้นท้ายรถ', true, 'CRITICAL', 130],
    ['SEAT_LAYOUT', 'รถตู้: ที่นั่งเป็นแถวตอนตามความกว้างรถ', true, 'MAJOR', 140],
    ['EMERGENCY_TOOLS', 'ค้อนทุบกระจกและเหล็กชะแลง', false, 'MAJOR', 150],
  ];
  for (const [code, label, na, sev, order] of seed) {
    await q(
      `INSERT INTO inspection_checklist_items
         (template_id, item_code, category, label_th, is_required, allows_na, fail_severity, sort_order)
       VALUES (?, ?, 'มาตรฐานรถโรงเรียน', ?, TRUE, ?, ?, ?)`,
      [templateId, code, label, na, sev, order]);
  }
}

/** A songthaew: rear guard applies, the van seat-layout item is N/A. */
async function songthaewItems({ fail = null } = {}) {
  const rows = await q('SELECT item_code FROM inspection_checklist_items WHERE template_id = ? AND is_required = TRUE', [templateId]);
  return rows.map(({ item_code: code }) => {
    if (code === 'SEAT_LAYOUT') return { item_code: code, result: 'NOT_APPLICABLE' };
    if (code === fail) return { item_code: code, result: 'FAIL', notes: 'ไม่มีค้อนทุบกระจก' };
    return { item_code: code, result: 'PASS' };
  });
}

async function cleanup() {
  if (auditMarker) {
    // pending_alert rows written by this file's runOnce (whatever item they name).
    await q("DELETE FROM audit_logs WHERE entity_type = 'pending_alert' AND id > ?", [auditMarker]);
  }
  const apps = (await q('SELECT id FROM vehicle_inspection_applications WHERE vehicle_id IN (?, ?)', [V1, V2])).map((r) => r.id);
  await q('DELETE iav FROM inspection_appointment_vehicles iav JOIN inspection_appointments ap ON ap.id = iav.appointment_id WHERE ap.school_id IN (?)', [[SA, SB, SC]]);
  await q('DELETE FROM inspection_appointments WHERE school_id IN (?)', [[SA, SB, SC]]);
  if (apps.length) {
    await q('DELETE FROM inspection_appointment_vehicles WHERE application_id IN (?)', [apps]);
    await q('DELETE FROM school_transport_certificates WHERE application_id IN (?)', [apps]);
    await q('DELETE r FROM inspection_checklist_results r JOIN inspection_attempts ia ON ia.id = r.attempt_id WHERE ia.application_id IN (?)', [apps]);
    await q('DELETE FROM inspection_attempts WHERE application_id IN (?)', [apps]);
    await q('DELETE FROM inspection_application_schools WHERE application_id IN (?)', [apps]);
    await q('DELETE FROM vehicle_inspection_applications WHERE id IN (?)', [apps]);
  }
  await q('DELETE FROM school_transport_certificates WHERE vehicle_id IN (?, ?)', [V1, V2]);
  await q('DELETE FROM school_certification_windows WHERE school_id IN (?)', [[SA, SB, SC]]);
  await q('DELETE FROM vehicle_inspections WHERE vehicle_id IN (?, ?)', [V1, V2]);
  if (await tableExists('vehicle_documents')) await q('DELETE FROM vehicle_documents WHERE vehicle_id IN (?, ?)', [V1, V2]);
  const drv = await q("SELECT id FROM drivers WHERE name = '__C3 Driver'");
  if (drv.length && await tableExists('driver_documents')) {
    await q('DELETE FROM driver_documents WHERE driver_id IN (?)', [drv.map((d) => d.id)]);
  }
  await q('DELETE FROM students WHERE id BETWEEN 99301 AND 99310');
  await q('DELETE FROM driver_vehicle_assignments WHERE vehicle_id IN (?, ?)', [V1, V2]);
  await q('DELETE FROM users WHERE username IN (?)', [USERNAMES]);
  if (drv.length) {
    await q('DELETE FROM driver_qualifications WHERE driver_id IN (?)', [drv.map((d) => d.id)]);
    await q('DELETE FROM drivers WHERE id IN (?)', [drv.map((d) => d.id)]);
  }
  await q('DELETE FROM vehicles WHERE id IN (?, ?)', [V1, V2]);
  await q('DELETE FROM schools WHERE id IN (?)', [[SA, SB, SC]]);
  await q('DELETE FROM affiliations WHERE id = ?', [AFF_C]);
}

beforeAll(async () => {
  flagBefore = env.features.schoolCertification;
  docFlagBefore = env.features.driverRegistration;
  env.features.schoolCertification = true;
  env.features.driverRegistration = false; // keep 044/045 queues (absent tables) out of the pending SQL
  term.invalidateTermCache();
  await cleanup();
  await ensureDocTables();
  await ensureChecklistV2();
  const [{ m }] = await q('SELECT COALESCE(MAX(id), 0) AS m FROM audit_logs');
  auditMarker = Number(m);

  await q("INSERT INTO affiliations (id, name) VALUES (?, '__C3 สังกัดทดลองซี')", [AFF_C]);
  await q(`INSERT INTO schools (id, name, affiliation_id) VALUES
    (?, '__C3 โรงเรียนทดลองเอ', '__TAFF'), (?, '__C3 โรงเรียนทดลองบี', '__TAFF'), (?, '__C3 โรงเรียนทดลองซี', ?)`,
  [SA, SB, SC, AFF_C]);
  const docDates = 'DATE_ADD(CURDATE(), INTERVAL 400 DAY)';
  await q(`INSERT INTO vehicles (id, plate_no, normalized_plate, canonical_plate, vehicle_type, certified_capacity,
      insurance_expiry, registration_expiry, compulsory_insurance_expiry, tax_expiry) VALUES
    (?, ?, '__c3สองแถว1', '__c3สองแถว1', 'รถสองแถว', 12, ${docDates}, ${docDates}, ${docDates}, ${docDates}),
    (?, ?, '__c3van2', '__c3van2', 'รถตู้', 12, ${docDates}, ${docDates}, ${docDates}, ${docDates})`,
  [V1, PLATE1, V2, PLATE2]);
  for (const [school, list] of Object.entries(STUDENTS)) {
    for (const id of list) {
      await q(`INSERT INTO students (id, cid_hash, prefix, first_name, last_name, grade, classroom,
          school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
        VALUES (?, SHA2(?, 256), 'เด็กชาย', '__C3', 'Pupil', 'ป.1', '1', ?, ?, TRUE, TRUE, '2569-2')`,
      [id, `c3-fixture-${id}`, school, V1]);
    }
  }
  await q(`INSERT INTO students (id, cid_hash, prefix, first_name, last_name, grade, classroom,
      school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
    VALUES (?, SHA2('c3-fixture-v2', 256), 'เด็กหญิง', '__C3', 'Pupil', 'ป.2', '1', ?, ?, TRUE, TRUE, '2569-2')`,
  [V2_STUDENT, SA, V2]);

  ids.driver = (await q("INSERT INTO drivers (name, phone) VALUES ('__C3 Driver', '0800000301')")).insertId;
  await q(`INSERT INTO driver_qualifications (driver_id, license_no, license_expiry, qualification_status, is_current)
    VALUES (?, '__C3-LIC', DATE_ADD(CURDATE(), INTERVAL 400 DAY), 'VERIFIED', TRUE)`, [ids.driver]);
  await q(`INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, assignment_role, authorization_status, start_date, is_active)
    VALUES (?, ?, 'PRIMARY', 'AUTHORIZED', CURDATE(), TRUE)`, [ids.driver, V1]);

  const hash = await bcrypt.hash(PASSWORD, 4);
  const addUser = async (username, role, scopeType, scopeId, extra = {}) => (await q(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name, grade_scope, driver_id, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
    [username, hash, role, scopeType, scopeId, username, extra.grade || null, extra.driverId || null])).insertId;
  ids.schoolA = await addUser('__c3_school_a', 'school', 'SCHOOL', SA);
  ids.schoolB = await addUser('__c3_school_b', 'school', 'SCHOOL', SB);
  ids.schoolC = await addUser('__c3_school_c', 'school', 'SCHOOL', SC);
  ids.teacherA = await addUser('__c3_teacher_a', 'school', 'SCHOOL', SA, { grade: 'ป.1' });
  ids.transport = await addUser('__c3_transport', 'transport', null, null);
  ids.driverUser = await addUser(PLATE1, 'driver', null, null, { driverId: ids.driver }); // plate username

  tok.A = await login('__c3_school_a');
  tok.B = await login('__c3_school_b');
  tok.C = await login('__c3_school_c');
  tok.teacherA = await login('__c3_teacher_a');
  tok.transport = await login('__c3_transport');
  tok.driver = await login(PLATE1);
  tok.other = await login('__test_school').catch(() => null); // tests/setup.js: unrelated school __TSCH
}, 60000);

afterAll(async () => {
  env.features.schoolCertification = flagBefore;
  env.features.driverRegistration = docFlagBefore;
  await cleanup();
  if (createdTemplate) {
    await q('DELETE FROM inspection_checklist_items WHERE template_id = ?', [templateId]);
    await q('DELETE FROM inspection_checklist_templates WHERE id = ?', [templateId]);
  }
  if (createdDocTables) {
    await q('DROP TABLE IF EXISTS vehicle_documents');
    await q('DROP TABLE IF EXISTS driver_documents');
  }
  await pool.end().catch(() => {});
});

const state = {};

describe('one songthaew, pupils of 3 schools (A issues, B same affiliation, C other affiliation)', () => {
  test('b. A sets the intake window (+พ.ร.บ.); driver uploads documents, sets caretaker, files → PENDING_SCHOOL_REVIEW', async () => {
    const today = todayBangkok();
    const w = await put('A', '/api/certification/school/window', {
      opens_on: term.addCalendarDays(today, -1), closes_on: term.addCalendarDays(today, 30),
      criteria_note: 'ยื่นเอกสารครบตามคู่มือ มพบ. 2564', require_compulsory_insurance: true,
    });
    expect(w.status).toBe(200);
    expect(w.body.data).toMatchObject({ window_state: 'OPEN', window: { require_compulsory_insurance: true } });
    // A grade teacher of A cannot touch certification at all.
    expect((await get('teacherA', '/api/certification/school/window')).status).toBe(403);

    const file = (n) => ({ storageKey: `c3-${n}.pdf`, originalName: `${n}.pdf`, mimeType: 'application/pdf', sha256: 'a'.repeat(64), fileSize: 10, uploadedBy: ids.driverUser });
    await docs.addDriverDocument(pool, { driverId: ids.driver, docType: 'ID_CARD', ...file('id') });
    await docs.addDriverDocument(pool, { driverId: ids.driver, docType: 'DRIVER_LICENCE', ...file('lic') });
    await docs.addVehicleDocument(pool, { vehicleId: V1, docType: 'VEHICLE_PHOTO', ...file('photo') });
    await docs.addVehicleDocument(pool, { vehicleId: V1, docType: 'VEHICLE_REGISTRATION', ...file('reg') });
    // พ.ร.บ. comes later — the checklist must show it missing first.

    const ct = await put('driver', '/api/certification/driver/caretaker', { name: 'นางทดลอง ดูแลดี', phone: '081-234-5678' });
    expect(ct.status).toBe(200);

    const schools = await get('driver', `/api/driver/applications/rider-schools?vehicle_id=${V1}`);
    expect(schools.status).toBe(200);
    expect(schools.body.data.map((s) => s.school_id).sort()).toEqual([SA, SB, SC].sort());

    // Shared vehicle: the driver names the issuing school (A has the most pupils anyway).
    const bad = await post('driver', '/api/driver/applications', { vehicle_id: V1, issuing_school_id: '__TSCH' });
    expect(bad.status).toBe(400);
    const filed = await post('driver', '/api/driver/applications', { vehicle_id: V1, issuing_school_id: SA });
    expect(filed.status).toBe(201);
    expect(filed.body.data).toMatchObject({ status: 'PENDING_SCHOOL_REVIEW', issuing_school_id: SA, total_schools: 3 });
    state.app1 = filed.body.data.id;
  });

  test('c. checklist missing/present; teacher 403; B and C cannot issue; A approves → certificate', async () => {
    const url = `/api/certification/school/applications/${state.app1}/checklist`;
    let cl = await get('A', url);
    expect(cl.status).toBe(200);
    expect(cl.body.data.missing).toEqual(['COMPULSORY_INSURANCE']);
    expect(cl.body.data.viewer_is_issuer).toBe(true);
    const pupils = cl.body.data.items.find((i) => i.code === 'PUPIL_LIST');
    expect(pupils).toMatchObject({ present: true, count: 4, total_count: 9 });
    expect(pupils.schools).toHaveLength(3);
    expect(cl.body.data.items.find((i) => i.code === 'CARETAKER')).toMatchObject({ present: true, name: 'นางทดลอง ดูแลดี' });

    await docs.addVehicleDocument(pool, {
      vehicleId: V1, docType: 'COMPULSORY_INSURANCE', storageKey: 'c3-prb.pdf', originalName: 'prb.pdf',
      mimeType: 'application/pdf', sha256: 'b'.repeat(64), fileSize: 10, uploadedBy: ids.driverUser,
    });
    cl = await get('A', url);
    expect(cl.body.data.missing).toEqual([]);

    expect((await get('teacherA', url)).status).toBe(403);
    expect((await post('teacherA', `/api/verification/applications/${state.app1}/review`, { approved: true })).status).toBe(403);

    // B / C see the checklist read-only but cannot issue or approve.
    const clB = await get('B', url);
    expect(clB.status).toBe(200);
    expect(clB.body.data.viewer_is_issuer).toBe(false);
    for (const who of ['B', 'C']) {
      const issue = await post(who, `/api/certification/school/applications/${state.app1}/certificate`);
      expect(issue.status).toBe(403);
      expect(issue.body.errors[0].code).toBe('ISSUING_SCHOOL_REQUIRED');
      const review = await post(who, `/api/verification/applications/${state.app1}/review`, { approved: true });
      expect(review.status).toBe(403);
    }
    if (tok.other) expect((await get('other', url)).status).toBe(404);

    const approved = await post('A', `/api/verification/applications/${state.app1}/review`, { approved: true });
    expect(approved.status).toBe(200);
    const termId = await term.getCurrentTerm(pool);
    state.termId = termId;
    state.termEnd = await term.getTermEndDate(pool, termId);
    expect(approved.body.data.status).toBe('READY_TO_PRINT');
    expect(approved.body.data.certificate).toMatchObject({ cert_no: `${SA}/${termId}/0001`, valid_until: state.termEnd, state: 'VALID' });
    expect(approved.body.data.warnings).toEqual([]);
    expect(approved.body.data.certificate.snapshot).toMatchObject({
      pupil_count: 4, total_pupil_count: 9, school_count: 3, caretaker_name: 'นางทดลอง ดูแลดี', driver_name: '__C3 Driver',
    });
    expect(JSON.stringify(approved.body.data.certificate.snapshot)).not.toMatch(/__C3 Pupil|first_name|cid_hash/);
    state.cert1 = approved.body.data.certificate;
  });

  test('d. B and C see the shared vehicle\'s certificate (detail, list, timeline, PDF) read-only', async () => {
    for (const who of ['B', 'C']) {
      const list = await get(who, '/api/verification/school/applications');
      expect(list.status).toBe(200);
      const row = list.body.data.find((a) => a.id === state.app1);
      expect(row.certificate).toMatchObject({ cert_no: state.cert1.cert_no, state: 'VALID' });

      const detail = await get(who, `/api/verification/applications/${state.app1}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({ issuing_school_id: SA, certificate: { cert_no: state.cert1.cert_no } });

      expect((await get(who, `/api/verification/applications/${state.app1}/timeline`)).status).toBe(200);

      const certs = await get(who, '/api/certification/school/certificates');
      expect(certs.status).toBe(200);
      expect(certs.body.data.find((c) => c.id === state.cert1.id)).toMatchObject({
        is_issuer: false, school_name: '__C3 โรงเรียนทดลองเอ', valid_until: state.termEnd, state: 'VALID',
      });

      const pdf = await get(who, `/api/certification/certificates/${state.cert1.id}/pdf`);
      expect(pdf.status).toBe(200);
      expect(pdf.headers['content-type']).toMatch(/application\/pdf/);

      const revoke = await post(who, `/api/certification/school/certificates/${state.cert1.id}/revoke`, { reason: 'ทดลองเพิกถอนแทน' });
      expect(revoke.status).toBe(403);
    }
    const own = await get('A', '/api/certification/school/certificates');
    expect(own.body.data.find((c) => c.id === state.cert1.id)).toMatchObject({ is_issuer: true });
    expect((await get('driver', `/api/certification/certificates/${state.cert1.id}/pdf`)).status).toBe(200);
    expect((await get('transport', `/api/certification/certificates/${state.cert1.id}/pdf`)).status).toBe(200);
    expect((await get('teacherA', `/api/certification/certificates/${state.cert1.id}/pdf`)).status).toBe(403);
    if (tok.other) expect((await get('other', `/api/certification/certificates/${state.cert1.id}/pdf`)).status).toBe(404);
    const [{ n }] = await q("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_type = 'school_transport_certificate' AND entity_id = ? AND action = 'EXPORT'", [String(state.cert1.id)]);
    expect(Number(n)).toBeGreaterThanOrEqual(4);
  });

  test('e. A asks transport for an inspection day; B cannot book A\'s application; transport confirms', async () => {
    const tomorrow = term.addCalendarDays(todayBangkok(), 1);
    expect((await post('B', '/api/certification/school/appointments', { proposed_date: tomorrow, application_ids: [state.app1] })).status).toBe(404);
    const ap = await post('A', '/api/certification/school/appointments', { proposed_date: tomorrow, note: 'ตรวจที่โรงเรียนเอ', application_ids: [state.app1] });
    expect(ap.status).toBe(201);
    state.appointment = ap.body.data.id;

    const tq = await pending.getSummary(pool, { role: 'transport', scopeId: null }, { detail: true });
    const apQueue = tq.queues.find((x) => x.key === 'inspection_appointments');
    expect(apQueue.items.map((i) => i.item_id)).toContain(String(state.appointment));

    const confirm = await post('transport', `/api/certification/transport/appointments/${state.appointment}/confirm`, { confirmed_date: tomorrow });
    expect(confirm.status).toBe(200);
    const mine = await get('A', '/api/certification/school/appointments');
    expect(mine.body.data.find((a) => a.id === state.appointment)).toMatchObject({
      status: 'CONFIRMED', confirmed_date: tomorrow, vehicles: [expect.objectContaining({ plate_no: PLATE1 })],
    });
  });

  test('f. start needs a certificate (second vehicle 409 → issue → OK); checklist v2; NEEDS_FIX → +15 days', async () => {
    // Vehicle 2 readied while the flag was still off (the go-live case): no certificate.
    env.features.schoolCertification = false;
    const app2 = await verification.createApplication(pool, { vehicleId: V2, issuingSchoolId: SA, userId: ids.schoolA });
    await verification.markReadyToPrint(pool, { applicationId: app2.id, schoolId: SA, userId: ids.schoolA });
    env.features.schoolCertification = true;
    state.app2 = app2.id;
    await expect(verification.startInspection(pool, { applicationId: app2.id, inspectorUserId: ids.transport }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'CERTIFICATE_REQUIRED' }] });
    const issued = await post('A', `/api/certification/school/applications/${app2.id}/certificate`);
    expect(issued.status).toBe(201);
    expect(issued.body.data.certificate.cert_no).toBe(`${SA}/${state.termId}/0002`);
    const s2 = await verification.startInspection(pool, { applicationId: app2.id, inspectorUserId: ids.transport });
    expect(s2.checklist_version).toBe(2);
    await verification.abortInspectionAttempt(pool, { attemptId: s2.attempt_id, actorUserId: ids.transport, reason: 'ทดสอบเริ่มตรวจได้แล้ว' })
      .catch(() => {});

    // The shared songthaew.
    const started = await verification.startInspection(pool, { applicationId: state.app1, inspectorUserId: ids.transport });
    expect(started.checklist_version).toBe(2);
    state.attempt1 = started.attempt_id;
    const items = await songthaewItems({ fail: 'EMERGENCY_TOOLS' });
    expect(items.find((i) => i.item_code === 'REAR_GUARD').result).not.toBe('NOT_APPLICABLE');
    // N/A only where the template allows it.
    await expect(verification.finalizeInspection(pool, {
      attemptId: started.attempt_id, inspectorUserId: ids.transport, result: 'NEEDS_FIX',
      items: items.map((i) => (i.item_code === 'NO_TINT' ? { item_code: 'NO_TINT', result: 'NOT_APPLICABLE' } : i)),
    })).rejects.toMatchObject({ statusCode: 400, errors: [expect.objectContaining({ code: 'NA_NOT_ALLOWED' })] });
    const fixed = await verification.finalizeInspection(pool, {
      attemptId: started.attempt_id, inspectorUserId: ids.transport, result: 'NEEDS_FIX', items,
    });
    expect(fixed).toMatchObject({ application_status: 'NEEDS_FIX', fix_deadline: term.addCalendarDays(todayBangkok(), 15) });
    const [r] = await q("SELECT r.result FROM inspection_checklist_results r JOIN inspection_checklist_items i ON i.id = r.checklist_item_id WHERE r.attempt_id = ? AND i.item_code = 'SEAT_LAYOUT'", [started.attempt_id]);
    expect(r.result).toBe('NOT_APPLICABLE');
  });

  test('h. fix deadline passed → one alert to the issuing school and one to transport, never twice; B/C see it on their list', async () => {
    await q('UPDATE vehicle_inspection_applications SET fix_deadline = ? WHERE id = ?', [term.addCalendarDays(todayBangkok(), -2), state.app1]);
    const first = await pending.runOnce({ db: pool });
    const mine = first.created.filter((w) => w.queue === 'fix_overdue' && w.item_id === String(state.app1));
    expect(mine.map((w) => [w.kind, w.target.role, w.target.scopeId || null]).sort()).toEqual([
      ['ESCALATED', 'transport', null],
      ['OVERDUE', 'school', SA],
    ]);
    const second = await pending.runOnce({ db: pool });
    expect(second.created.filter((w) => w.item_id === String(state.app1) && w.queue === 'fix_overdue')).toEqual([]);

    const a = await pending.getSummary(pool, { role: 'school', scopeId: SA }, { detail: true });
    expect(a.queues.find((x) => x.key === 'fix_overdue').items.map((i) => i.item_id)).toContain(String(state.app1));
    expect(a.alerts.some((x) => x.queue === 'fix_overdue' && x.item_id === String(state.app1))).toBe(true);
    const t = await pending.getSummary(pool, { role: 'transport', scopeId: null }, { detail: true });
    expect(t.escalated.items.some((i) => i.queue === 'fix_overdue' && i.item_id === String(state.app1))).toBe(true);
    expect(t.alerts.some((x) => x.queue === 'fix_overdue' && x.item_id === String(state.app1))).toBe(true);
    // B / C: not alerted (they cannot act) but see "เลยกำหนดยื่นใหม่" on their own list.
    for (const [who, school] of [['B', SB], ['C', SC]]) {
      const s = await pending.getSummary(pool, { role: 'school', scopeId: school }, { detail: true });
      expect(JSON.stringify(s)).not.toContain(`"item_id":"${state.app1}"`);
      const list = await get(who, '/api/verification/school/applications');
      expect(list.body.data.find((x) => x.id === state.app1)).toMatchObject({ status: 'NEEDS_FIX', fix_overdue: true });
    }
    const teacher = await pending.getSummary(pool, { role: 'school', scopeId: SA, gradeScope: 'ป.1' }, { detail: true });
    expect(teacher.total).toBe(0);
  });

  test('f (cont.). re-inspection: PASSED past the term end → 400, default → term end', async () => {
    const again = await verification.startInspection(pool, { applicationId: state.app1, inspectorUserId: ids.transport });
    const items = await songthaewItems();
    await expect(verification.finalizeInspection(pool, {
      attemptId: again.attempt_id, inspectorUserId: ids.transport, result: 'PASSED',
      expiryDate: term.addCalendarDays(state.termEnd, 1), items,
    })).rejects.toMatchObject({ statusCode: 400, errors: [expect.objectContaining({ code: 'EXPIRY_AFTER_TERM_END' })] });
    const passed = await verification.finalizeInspection(pool, {
      attemptId: again.attempt_id, inspectorUserId: ids.transport, result: 'PASSED', items,
    });
    expect(passed).toMatchObject({ application_status: 'PASSED', expiry_date: state.termEnd, fix_deadline: null });
    // The overdue item is resolved, so its alerts drop out of the live list.
    const a = await pending.getSummary(pool, { role: 'school', scopeId: SA }, { detail: true });
    expect(a.alerts.some((x) => x.item_id === String(state.app1) && x.queue === 'fix_overdue')).toBe(false);
  });

  test('g. eligibility ELIGIBLE/EXPIRING; A revokes → CERTIFICATE_REVOKED, B sees it; a new inspection is blocked', async () => {
    const ok = await verification.refreshVehicleEligibility(pool, V1);
    expect(['ELIGIBLE', 'EXPIRING']).toContain(ok.status);
    expect(ok.reasons).toEqual([]);

    const rv = await post('A', `/api/certification/school/certificates/${state.cert1.id}/revoke`, { reason: 'ผู้ดูแลนักเรียนลาออก' });
    expect(rv.status).toBe(200);
    const [veh] = await q('SELECT verification_status, verification_reasons_json FROM vehicles WHERE id = ?', [V1]);
    const reasons = typeof veh.verification_reasons_json === 'string' ? JSON.parse(veh.verification_reasons_json) : veh.verification_reasons_json;
    expect(veh.verification_status).toBe('INELIGIBLE');
    expect(reasons).toContain('CERTIFICATE_REVOKED');
    const seenByB = await get('B', '/api/certification/school/certificates');
    expect(seenByB.body.data.find((c) => c.id === state.cert1.id)).toMatchObject({ state: 'REVOKED', revoke_reason: 'ผู้ดูแลนักเรียนลาออก' });

    // Next application for the same vehicle: approved (certificate 0003), then revoked → transport cannot start.
    const filed = await post('driver', '/api/driver/applications', { vehicle_id: V1, issuing_school_id: SA });
    expect(filed.status).toBe(201);
    state.app3 = filed.body.data.id;
    const approved = await post('A', `/api/verification/applications/${state.app3}/review`, { approved: true });
    expect(approved.body.data.certificate.cert_no).toBe(`${SA}/${state.termId}/0003`);
    expect((await post('A', `/api/certification/school/certificates/${approved.body.data.certificate.id}/revoke`, { reason: 'เอกสารไม่ถูกต้อง' })).status).toBe(200);
    await expect(verification.startInspection(pool, { applicationId: state.app3, inspectorUserId: ids.transport }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'CERTIFICATE_REQUIRED' }] });
  });

  test('i. pending summaries per role, and nothing reached LINE', async () => {
    const a = await get('A', '/api/school/pending-summary?detail=1');
    expect(a.status).toBe(200);
    const teacher = await get('teacherA', '/api/school/pending-summary');
    if (teacher.status === 200) expect(teacher.body.data.total).toBe(0);
    else expect(teacher.status).toBe(403);
    const b = await pending.getSummary(pool, { role: 'school', scopeId: SB }, { detail: true });
    expect(b.queues.every((x) => !(x.items || []).some((i) => i.school_id === SA))).toBe(true);
    const calls = [lineSvc, lineDispatch]
      .flatMap((m) => Object.values(m).filter((f) => typeof f === 'function' && f.mock))
      .reduce((n, f) => n + f.mock.calls.length, 0);
    expect(calls).toBe(0);
  });
});
