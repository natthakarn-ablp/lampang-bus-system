'use strict';

/**
 * schoolCertification.test.js — INTEGRATION (disposable lampang_bus_test DB;
 * tests/schema.sql carries migration 063's tables/columns).
 *
 * Real-MySQL run of the มพบ. 2564 certification flow with
 * FEATURE_SCHOOL_CERTIFICATION on: school readies an application → certificate
 * issued (<school>/<term>/0001, valid to the term end) → another school cannot
 * issue → intake window → appointment request/confirm/done → revoke →
 * transport cannot start → re-issue (0002) → start → PASSED past the term end
 * refused → NEEDS_FIX sets the 15-day fix deadline → pending-queue SQL.
 * Own fixtures only (school __TSC63, vehicle V-cert063fix1), removed after.
 */

require('./loadTestEnv');
const { getTestConnection } = require('./dbHelper');
const env = require('../src/config/env');
const { pool } = require('../src/config/database');
const cert = require('../src/services/schoolCertification.service');
const verification = require('../src/services/vehicleVerification.service');
const pending = require('../src/services/pendingQueue.service');
const term = require('../src/services/term.service');
const { todayBangkok } = require('../src/utils/thaiTime');

const SCHOOL = '__TSC63';
const VEHICLE = 'V-cert063fix1';
const PLATE = '__CERT 0063';
const STUDENT = 99063;
let schoolUserId;
let transportUserId;
let templateId = null;
let createdTemplate = false;
let flagBefore;
let docFlagBefore;

async function q(sql, params = []) {
  const conn = await getTestConnection();
  try { return (await conn.query(sql, params))[0]; } finally { await conn.end(); }
}

async function cleanup() {
  const apps = await q('SELECT id FROM vehicle_inspection_applications WHERE vehicle_id = ?', [VEHICLE]);
  const ids = apps.map((a) => a.id);
  if (ids.length) {
    await q('DELETE iav FROM inspection_appointment_vehicles iav WHERE iav.application_id IN (?)', [ids]);
    await q('DELETE FROM school_transport_certificates WHERE application_id IN (?)', [ids]);
    await q(`DELETE r FROM inspection_checklist_results r
               JOIN inspection_attempts ia ON ia.id = r.attempt_id WHERE ia.application_id IN (?)`, [ids]);
    await q('DELETE FROM inspection_attempts WHERE application_id IN (?)', [ids]);
    await q('DELETE FROM inspection_application_schools WHERE application_id IN (?)', [ids]);
    await q('DELETE FROM vehicle_inspection_applications WHERE id IN (?)', [ids]);
  }
  await q('DELETE FROM inspection_appointment_vehicles WHERE appointment_id IN (SELECT id FROM inspection_appointments WHERE school_id = ?)', [SCHOOL]);
  await q('DELETE FROM inspection_appointments WHERE school_id = ?', [SCHOOL]);
  await q('DELETE FROM school_certification_windows WHERE school_id = ?', [SCHOOL]);
  await q('DELETE FROM vehicle_inspections WHERE vehicle_id = ?', [VEHICLE]);
  await q('DELETE FROM students WHERE id = ?', [STUDENT]);
  await q('DELETE FROM vehicles WHERE id = ?', [VEHICLE]);
  await q("DELETE FROM users WHERE username IN ('__cert063_school', '__cert063_transport')");
  await q('DELETE FROM schools WHERE id = ?', [SCHOOL]);
}

beforeAll(async () => {
  flagBefore = env.features.schoolCertification;
  docFlagBefore = env.features.driverRegistration;
  env.features.schoolCertification = true;
  // tests/schema.sql predates 044/045 (registration roster, documents): keep
  // their flag-gated queues out, as pendingAutomationSql.test.js does.
  env.features.driverRegistration = false;
  term.invalidateTermCache();
  await cleanup();
  await q("INSERT INTO schools (id, name, affiliation_id) VALUES (?, '__Cert School 063', '__TAFF')", [SCHOOL]);
  schoolUserId = (await q(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name)
     VALUES ('__cert063_school', 'fixture-only-no-login', 'school', 'SCHOOL', ?, '__cert063_school')`, [SCHOOL])).insertId;
  transportUserId = (await q(
    `INSERT INTO users (username, password_hash, role, display_name)
     VALUES ('__cert063_transport', 'fixture-only-no-login', 'transport', '__cert063_transport')`)).insertId;
  await q(
    `INSERT INTO vehicles (id, plate_no, normalized_plate, canonical_plate, vehicle_type, certified_capacity,
       insurance_expiry, registration_expiry, compulsory_insurance_expiry, tax_expiry)
     VALUES (?, ?, '__cert0063', '__cert0063', 'van', 12,
       DATE_ADD(CURDATE(), INTERVAL 400 DAY), DATE_ADD(CURDATE(), INTERVAL 400 DAY),
       DATE_ADD(CURDATE(), INTERVAL 400 DAY), DATE_ADD(CURDATE(), INTERVAL 400 DAY))`, [VEHICLE, PLATE]);
  await q(
    `INSERT INTO students (id, cid_hash, prefix, first_name, last_name, grade, classroom,
       school_id, vehicle_id, morning_enabled, evening_enabled, term_id)
     VALUES (?, SHA2('cert063-fixture', 256), 'เด็กชาย', '__Cert', 'Pupil', 'ป.2', '1', ?, ?, TRUE, TRUE, '2569-2')`,
    [STUDENT, SCHOOL, VEHICLE]);
  const tpl = await q("SELECT id FROM inspection_checklist_templates WHERE template_code = 'LAMPANG_SCHOOLBUS' AND is_active = TRUE ORDER BY version_no LIMIT 1");
  if (tpl.length) {
    templateId = tpl[0].id;
  } else {
    templateId = (await q(
      `INSERT INTO inspection_checklist_templates (template_code, template_name, version_no, is_active)
       VALUES ('LAMPANG_SCHOOLBUS', '__cert063 fixture', 1, TRUE)`)).insertId;
    createdTemplate = true;
  }
  await q(
    `INSERT IGNORE INTO inspection_checklist_items (template_id, item_code, category, label_th, fail_severity, sort_order)
     VALUES (?, '__CERT063_ITEM', 'fixture', 'fixture', 'MAJOR', 1)`, [templateId]);
});

afterAll(async () => {
  env.features.schoolCertification = flagBefore;
  env.features.driverRegistration = docFlagBefore;
  await cleanup();
  await q('DELETE FROM inspection_checklist_items WHERE template_id = ? AND item_code = ?', [templateId, '__CERT063_ITEM']);
  if (createdTemplate) {
    await q('DELETE FROM inspection_checklist_items WHERE template_id = ?', [templateId]);
    await q('DELETE FROM inspection_checklist_templates WHERE id = ?', [templateId]);
  }
  await pool.end().catch(() => {});
});

/** Only this test's required items (the shared template may hold others). */
async function itemsFor(result, notes) {
  const rows = await q('SELECT item_code FROM inspection_checklist_items WHERE template_id = ? AND is_required = TRUE', [templateId]);
  return rows.map((r) => ({ item_code: r.item_code, result: r.item_code === '__CERT063_ITEM' ? result : 'PASS', notes }));
}

test('full certification flow on real MySQL', async () => {
  const termId = await term.getCurrentTerm(pool);
  const termEnd = await term.getTermEndDate(pool, termId);

  // School creates + readies an application → certificate issued.
  const app = await verification.createApplication(pool, { vehicleId: VEHICLE, issuingSchoolId: SCHOOL, userId: schoolUserId });
  const ready = await verification.markReadyToPrint(pool, { applicationId: app.id, schoolId: SCHOOL, userId: schoolUserId });
  expect(ready.status).toBe('READY_TO_PRINT');
  expect(ready.certificate.cert_no).toBe(`${SCHOOL}/${termId}/0001`);
  expect(ready.certificate.valid_until).toBe(termEnd);
  expect(ready.certificate.snapshot.pupil_count).toBe(1);

  // Another school cannot issue for this application.
  await expect(cert.issueCertificate(pool, { applicationId: app.id, schoolId: '__TSCH', userId: schoolUserId }))
    .rejects.toMatchObject({ statusCode: 404 });

  // Intake window + checklist (document tables are absent in the test schema → all missing).
  await cert.setWindow(pool, { schoolId: SCHOOL, userId: schoolUserId, opensOn: todayBangkok(), closesOn: todayBangkok(), requireCompulsoryInsurance: true });
  const summary = await cert.getWindowSummary(pool, SCHOOL);
  expect(summary).toMatchObject({ term_id: termId, window_state: 'OPEN', window: { require_compulsory_insurance: true } });
  const checklist = await cert.getDocumentChecklist(pool, { applicationId: app.id, schoolId: SCHOOL });
  expect(checklist.items.map((i) => i.code)).toEqual(expect.arrayContaining(['ID_CARD', 'COMPULSORY_INSURANCE', 'PUPIL_LIST', 'CARETAKER']));
  expect(checklist.items.find((i) => i.code === 'PUPIL_LIST')).toMatchObject({ present: true, count: 1 });

  // Inspection-day appointment.
  const tomorrow = term.addCalendarDays(todayBangkok(), 1);
  const ap = await cert.createAppointment(pool, { schoolId: SCHOOL, userId: schoolUserId, proposedDate: tomorrow, applicationIds: [app.id] });
  await cert.confirmAppointment(pool, { appointmentId: ap.id, userId: transportUserId, confirmedDate: tomorrow });
  const listed = await cert.listAppointments(pool, { schoolId: SCHOOL });
  expect(listed[0]).toMatchObject({ status: 'CONFIRMED', confirmed_date: tomorrow, vehicles: [expect.objectContaining({ plate_no: PLATE })] });
  await cert.markAppointmentDone(pool, { appointmentId: ap.id, userId: transportUserId });

  // Revoke → transport cannot start; re-issue → number 0002.
  await cert.revokeCertificate(pool, { certificateId: ready.certificate.id, schoolId: SCHOOL, userId: schoolUserId, reason: 'เอกสารไม่ครบถ้วน' });
  await expect(verification.startInspection(pool, { applicationId: app.id, inspectorUserId: transportUserId }))
    .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'CERTIFICATE_REQUIRED' }] });
  const reissued = await cert.issueCertificate(pool, { applicationId: app.id, schoolId: SCHOOL, userId: schoolUserId });
  expect(reissued.certificate.cert_no).toBe(`${SCHOOL}/${termId}/0002`);

  const queue = await verification.listTransportQueue(pool, { search: PLATE });
  expect(queue[0].certificate).toMatchObject({ cert_no: `${SCHOOL}/${termId}/0002`, state: 'VALID' });

  // Start, refuse a pass past the term end, then NEEDS_FIX → 15-day deadline.
  const started = await verification.startInspection(pool, { applicationId: app.id, inspectorUserId: transportUserId });
  await expect(verification.finalizeInspection(pool, {
    attemptId: started.attempt_id, inspectorUserId: transportUserId, result: 'PASSED',
    expiryDate: term.addCalendarDays(termEnd, 1), items: await itemsFor('PASS'),
  })).rejects.toMatchObject({ statusCode: 400, errors: [expect.objectContaining({ code: 'EXPIRY_AFTER_TERM_END' })] });
  const fixed = await verification.finalizeInspection(pool, {
    attemptId: started.attempt_id, inspectorUserId: transportUserId, result: 'NEEDS_FIX',
    items: await itemsFor('FAIL', 'ป้ายรถโรงเรียนไม่ครบ'),
  });
  expect(fixed.fix_deadline).toBe(term.addCalendarDays(todayBangkok(), 15));
  const [row] = await q("SELECT status, DATE_FORMAT(fix_deadline, '%Y-%m-%d') AS d FROM vehicle_inspection_applications WHERE id = ?", [app.id]);
  expect(row).toEqual({ status: 'NEEDS_FIX', d: fixed.fix_deadline });

  // Resubmission inside the deadline: NEEDS_FIX goes back to the queue, a pass defaults to the term end.
  const again = await verification.startInspection(pool, { applicationId: app.id, inspectorUserId: transportUserId });
  const passed = await verification.finalizeInspection(pool, {
    attemptId: again.attempt_id, inspectorUserId: transportUserId, result: 'PASSED', items: await itemsFor('PASS'),
  });
  expect(passed.expiry_date).toBe(termEnd);
  expect(passed.eligibility.reasons).not.toEqual(expect.arrayContaining(['CERTIFICATE_MISSING', 'CERTIFICATE_REVOKED']));
});

test('pending-queue SQL with the certification queues on', async () => {
  for (const [role, scopeId] of [['school', SCHOOL], ['transport', null], ['province', null], ['affiliation', '__TAFF']]) {
    const out = await pending.getSummary(pool, { role, scopeId }, { detail: true });
    expect(Number.isInteger(out.total)).toBe(true);
  }
  const r = await pending.runOnce({ db: pool, dryRun: true });
  expect(r.considered).toBeGreaterThanOrEqual(r.created.length);
  expect(Array.isArray(await cert.listSchoolCertificates(pool, { schoolId: SCHOOL }))).toBe(true);
  expect(Array.isArray(await cert.listVehicleCertificates(pool, { vehicleId: VEHICLE }))).toBe(true);
});
