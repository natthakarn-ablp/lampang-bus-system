'use strict';

/**
 * School transport certification (มพบ. 2564 "ล้อที่ 3", migration 063,
 * FEATURE_SCHOOL_CERTIFICATION) — DB-free. Pure rules, service scope with a
 * fake connection, inspection hooks (start/finalize), pending-queue alerts,
 * route gating, and the flag-off / migration-guard contract.
 * Integration counterpart (real MySQL): schoolCertification.test.js.
 */

require('./loadTestEnv');
const fs = require('fs');
const path = require('path');
const env = require('../src/config/env');
const svc = require('../src/services/schoolCertification.service');
const term = require('../src/services/term.service');
const verification = require('../src/services/vehicleVerification.service');
const pending = require('../src/services/pendingQueue.service');
const { todayBangkok } = require('../src/utils/thaiTime');

beforeEach(() => { env.features.schoolCertification = false; });
afterAll(() => { env.features.schoolCertification = false; });

/** Routes SQL to handlers by regex; records every call. */
function fakeConn(routes) {
  const calls = [];
  const conn = {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      for (const [re, fn] of routes) if (re.test(sql)) return typeof fn === 'function' ? fn(sql, params) : fn;
      if (/INSERT INTO audit_logs/.test(sql)) return [{ insertId: 1 }];
      throw new Error(`unexpected SQL: ${sql.replace(/\s+/g, ' ').slice(0, 120)}`);
    },
    beginTransaction: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    release: jest.fn(),
  };
  return { ...conn, getConnection: async () => conn, conn };
}

describe('pure rules', () => {
  test('cert number is <school>/<term>/<4-digit running>', () => {
    expect(svc.formatCertNo('SCH0001', '2569-2', 7)).toBe('SCH0001/2569-2/0007');
    expect(svc.formatCertNo('SCH0001', '2569-2', 12345)).toBe('SCH0001/2569-2/12345');
    expect(svc.certSeq('SCH0001/2569-2/0042')).toBe(42);
    expect(svc.certSeq('garbage')).toBe(0);
  });

  test('term end by convention: term 1 → 11 Oct, term 2 → 1 Apr next year', () => {
    expect(term.termEndByConvention('2569-1')).toBe('2026-10-11');
    expect(term.termEndByConvention('2569-2')).toBe('2027-04-01');
    expect(term.termEndByConvention('bad')).toBeNull();
  });

  test('term end prefers terms.end_date and falls back to the convention', async () => {
    const withRow = { query: jest.fn().mockResolvedValue([[{ end_date: '2027-03-15' }]]) };
    expect(await term.getTermEndDate(withRow, '2569-2')).toBe('2027-03-15');
    const broken = { query: jest.fn().mockRejectedValue(new Error('no table')) };
    expect(await term.getTermEndDate(broken, '2569-2')).toBe('2027-04-01');
  });

  test('certificate state and eligibility reasons', () => {
    const today = '2026-11-14';
    expect(svc.certificateReasons(null, today)).toEqual({ reasons: ['CERTIFICATE_MISSING'], expiring: false });
    expect(svc.certificateReasons({ valid_until: '2026-11-13' }, today).reasons).toEqual(['CERTIFICATE_EXPIRED']);
    expect(svc.certificateReasons({ valid_until: '2027-04-01', revoked_at: '2026-11-10' }, today).reasons)
      .toEqual(['CERTIFICATE_REVOKED']);
    expect(svc.certificateReasons({ valid_until: '2026-12-10' }, today)).toEqual({ reasons: [], expiring: true });
    expect(svc.certificateReasons({ valid_until: '2027-04-01' }, today)).toEqual({ reasons: [], expiring: false });
  });

  test('governing certificate is the newest valid one, else the newest', () => {
    const today = '2026-11-14';
    const revoked = { id: 3, valid_until: '2027-04-01', revoked_at: 'x' };
    const valid = { id: 2, valid_until: '2027-04-01' };
    expect(svc.pickGoverningCertificate([revoked, valid], today)).toBe(valid);
    expect(svc.pickGoverningCertificate([revoked], today)).toBe(revoked);
    expect(svc.pickGoverningCertificate([], today)).toBeNull();
  });

  test('expiry is capped at the term end; missing expiry defaults to it', () => {
    expect(svc.capExpiryToTerm({ expiryDate: null, termEnd: '2027-04-01' })).toEqual({ expiry: '2027-04-01' });
    expect(svc.capExpiryToTerm({ expiryDate: '2027-03-01', termEnd: '2027-04-01' })).toEqual({ expiry: '2027-03-01' });
    expect(svc.capExpiryToTerm({ expiryDate: '2027-04-01', termEnd: '2027-04-01' })).toEqual({ expiry: '2027-04-01' });
    const late = svc.capExpiryToTerm({ expiryDate: '2027-04-02', termEnd: '2027-04-01' });
    expect(late.error.code).toBe('EXPIRY_AFTER_TERM_END');
  });

  test('fix deadline is 15 days; overdue only for FAILED/NEEDS_FIX past it', () => {
    expect(svc.fixDeadlineFor('2026-11-14')).toBe('2026-11-29');
    expect(svc.fixDeadlineFor('2026-12-25')).toBe('2027-01-09');
    expect(svc.isFixOverdue({ status: 'NEEDS_FIX', fix_deadline: '2026-11-13' }, '2026-11-14')).toBe(true);
    expect(svc.isFixOverdue({ status: 'NEEDS_FIX', fix_deadline: '2026-11-14' }, '2026-11-14')).toBe(false);
    expect(svc.isFixOverdue({ status: 'PASSED', fix_deadline: '2026-11-01' }, '2026-11-14')).toBe(false);
    expect(svc.isFixOverdue({ status: 'FAILED', fix_deadline: null }, '2026-11-14')).toBe(false);
  });

  test('intake window state', () => {
    expect(svc.windowState(null, '2026-11-14')).toBe('NOT_SET');
    expect(svc.windowState({ opens_on: '2026-11-20', closes_on: '2026-12-01' }, '2026-11-14')).toBe('BEFORE');
    expect(svc.windowState({ opens_on: '2026-11-01', closes_on: '2026-12-01' }, '2026-11-14')).toBe('OPEN');
    expect(svc.windowState({ opens_on: '2026-10-01', closes_on: '2026-10-31' }, '2026-11-14')).toBe('CLOSED');
  });

  test('document checklist: พ.ร.บ. only when the school requires it; rejected docs do not count', () => {
    const base = {
      vehicleDocs: [{ id: 1, doc_type: 'VEHICLE_PHOTO', review_status: 'PENDING' },
        { id: 2, doc_type: 'VEHICLE_REGISTRATION', review_status: 'REJECTED' }],
      driverDocs: [{ id: 3, doc_type: 'ID_CARD', review_status: 'APPROVED' }],
      pupilCount: 4,
      caretaker: { name: 'นางดูแล', phone: '0811111111' },
    };
    const items = svc.buildChecklistItems(base);
    const byCode = Object.fromEntries(items.map((i) => [i.code, i]));
    expect(byCode.COMPULSORY_INSURANCE).toBeUndefined();
    expect(byCode.ID_CARD.present).toBe(true);
    expect(byCode.DRIVER_LICENCE.present).toBe(false);
    expect(byCode.VEHICLE_PHOTO.present).toBe(true);
    expect(byCode.VEHICLE_REGISTRATION.present).toBe(false);
    expect(byCode.PUPIL_LIST).toMatchObject({ present: true, count: 4 });
    expect(byCode.CARETAKER.present).toBe(true);
    const withCmi = svc.buildChecklistItems({ ...base, requireCompulsoryInsurance: true, caretaker: { name: 'x' } });
    expect(withCmi.find((i) => i.code === 'COMPULSORY_INSURANCE').present).toBe(false);
    expect(withCmi.find((i) => i.code === 'CARETAKER').present).toBe(false);
  });
});

describe('eligibility (computeEligibility)', () => {
  const ok = {
    inspection: { result: 'PASSED', expiry_date: '2099-12-31' },
    documents: {
      insurance_expiry: '2099-12-31', registration_expiry: '2099-12-31',
      compulsory_insurance_expiry: '2099-12-31', tax_expiry: '2099-12-31',
    },
    capacity: 20, peakRiders: 5, validDriverCount: 1, today: '2026-11-14',
  };
  test('certificate undefined (flag off) changes nothing', () => {
    expect(verification.computeEligibility(ok)).toEqual({ status: 'ELIGIBLE', reasons: [] });
  });
  test.each([
    [null, 'CERTIFICATE_MISSING'],
    [{ valid_until: '2026-01-01' }, 'CERTIFICATE_EXPIRED'],
    [{ valid_until: '2027-04-01', revoked_at: '2026-11-01' }, 'CERTIFICATE_REVOKED'],
  ])('certificate %j → %s', (certificate, reason) => {
    expect(verification.computeEligibility({ ...ok, certificate })).toEqual({ status: 'INELIGIBLE', reasons: [reason] });
  });
  test('certificate ending within 30 days → EXPIRING', () => {
    expect(verification.computeEligibility({ ...ok, certificate: { valid_until: '2026-12-01' } }).status).toBe('EXPIRING');
  });
});

describe('service scope', () => {
  test('flag off: every write answers 404 FEATURE_DISABLED', async () => {
    const db = fakeConn([]);
    await expect(svc.issueCertificate(db, { applicationId: 1, schoolId: 'A', userId: 1 }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.revokeCertificate(db, { certificateId: 1, schoolId: 'A', userId: 1, reason: 'เหตุผลยาวพอ' }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.confirmAppointment(db, { appointmentId: 1, userId: 1, confirmedDate: '2099-01-01' }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(db.calls).toHaveLength(0);
  });

  test('school A cannot issue for school B\'s application (404, rolled back)', async () => {
    env.features.schoolCertification = true;
    const db = fakeConn([
      [/FROM vehicle_inspection_applications a\s+JOIN vehicles v/, [[{
        id: 5, status: 'READY_TO_PRINT', vehicle_id: 'V1', issuing_school_id: 'B', requested_by: 9,
      }]]],
      [/FROM inspection_application_schools/, [[]]],
      [/SELECT 1 AS ok FROM students/, [[]]],
    ]);
    await expect(svc.issueCertificate(db, { applicationId: 5, schoolId: 'A', userId: 1 }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(db.conn.rollback).toHaveBeenCalled();
    expect(db.calls.some((c) => /INSERT INTO school_transport_certificates/.test(c.sql))).toBe(false);
  });

  test('school A cannot revoke school B\'s certificate; reason is required', async () => {
    env.features.schoolCertification = true;
    const db = fakeConn([[/FROM school_transport_certificates\s+WHERE id = \? FOR UPDATE/, [[{
      id: 3, cert_no: 'B/2569-2/0001', school_id: 'B', vehicle_id: 'V1', revoked_at: null,
    }]]], [/SELECT 1 AS ok FROM students/, [[]]]]);
    await expect(svc.revokeCertificate(db, { certificateId: 3, schoolId: 'A', userId: 1, reason: 'ไม่ผ่านเกณฑ์' }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.revokeCertificate(db, { certificateId: 3, schoolId: 'B', userId: 1, reason: '' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(db.calls.some((c) => /UPDATE school_transport_certificates/.test(c.sql))).toBe(false);
  });

  test('issue numbers after the highest running number, valid to term end, warns outside window', async () => {
    env.features.schoolCertification = true;
    term.invalidateTermCache();
    const today = todayBangkok();
    const closed = term.addCalendarDays(today, -10);
    const currentTerm = await term.getCurrentTerm({ query: async () => [[]] });
    const db = fakeConn([
      [/c\.revoked_at IS NULL AND c\.valid_until >= \?/, [[]]],
      [/FROM vehicle_inspection_applications a\s+JOIN vehicles v/, [[{
        id: 5, request_no: 'VIA-1', status: 'READY_TO_PRINT', vehicle_id: 'V1', issuing_school_id: 'A',
        requested_by: 9, plate_no: 'กข 1', vehicle_type: 'van', caretaker_name: 'นางดูแล',
        caretaker_phone: '0811111111', issuing_school_name: 'โรงเรียนเอ',
      }]]],
      [/FROM terms\s+WHERE start_date/, [[]]],
      [/FROM terms WHERE id = \?/, [[{ end_date: '2027-03-31' }]]],
      [/FROM school_certification_windows/, [[{ opens_on: term.addCalendarDays(today, -30), closes_on: closed, require_compulsory_insurance: 0 }]]],
      [/FROM users u JOIN drivers d/, [[{ driver_id: 4, driver_name: 'สมชาย' }]]],
      [/FROM vehicle_documents/, [[]]],
      [/FROM driver_documents/, [[]]],
      [/COUNT\(\*\) AS n\s+FROM students s/, [[
        { school_id: 'A', school_name: 'โรงเรียนเอ', n: 6 },
        { school_id: 'B', school_name: 'โรงเรียนบี', n: 3 },
      ]]],
      [/WHERE c\.application_id = \? ORDER BY c\.id DESC LIMIT 1/, [[]]],
      [/WHERE c\.vehicle_id = \? AND c\.school_id <> \?/, [[{
        id: 70, cert_no: 'B/x/0001', school_id: 'B', school_name: 'โรงเรียนบี', term_id: currentTerm,
        valid_until: '2099-01-01', revoked_at: new Date(), revoke_reason: 'ไม่ผ่านเกณฑ์',
      }]]],
      [/SELECT id FROM schools WHERE id = \? FOR UPDATE/, [[{ id: 'A' }]]],
      [/SELECT cert_no FROM school_transport_certificates/, [[{ cert_no: 'A/x/0001' }, { cert_no: 'A/x/0003' }]]],
      [/INSERT INTO school_transport_certificates/, [{ insertId: 77 }]],
      [/WHERE c\.id = \?/, (_s, p) => [[{ id: p[0], cert_no: 'stub', valid_until: '2027-03-31' }]]],
    ]);
    const out = await svc.issueCertificateInTx(db.conn, { applicationId: 5, schoolId: 'A', userId: 1 });
    const ins = db.calls.find((c) => /INSERT INTO school_transport_certificates/.test(c.sql));
    const termId = await term.getCurrentTerm({ query: async () => [[]] });
    expect(ins.params[0]).toBe(`A/${termId}/0004`);
    expect(ins.params[6]).toBe('2027-03-31');
    const snapshot = JSON.parse(ins.params[8]);
    expect(snapshot).toMatchObject({
      pupil_count: 6, total_pupil_count: 9, school_count: 2, caretaker_name: 'นางดูแล',
      schools: [{ school_name: 'โรงเรียนเอ', pupil_count: 6 }, { school_name: 'โรงเรียนบี', pupil_count: 3 }],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/first_name|student_id|cid/);
    expect(out.created).toBe(true);
    expect(out.warnings).toEqual(expect.arrayContaining(['OUTSIDE_WINDOW', 'DOCUMENTS_MISSING', 'REVOKED_BY_OTHER_SCHOOL']));
    expect(db.calls.some((c) => /INSERT INTO audit_logs/.test(c.sql))).toBe(true);
  });

  test('shared vehicle: a rider school gets 403 (not 404) on issue and revoke, and may print', async () => {
    env.features.schoolCertification = true;
    const rides = [/SELECT 1 AS ok FROM students/, [[{ ok: 1 }]]];
    const issueDb = fakeConn([
      [/FROM vehicle_inspection_applications a\s+JOIN vehicles v/, [[{
        id: 5, status: 'READY_TO_PRINT', vehicle_id: 'V1', issuing_school_id: 'A', issuing_school_name: 'โรงเรียนเอ',
      }]]],
      [/FROM inspection_application_schools/, [[{ ok: 1 }]]],
      rides,
    ]);
    await expect(svc.issueCertificate(issueDb, { applicationId: 5, schoolId: 'B', userId: 1 }))
      .rejects.toMatchObject({ statusCode: 403, errors: [expect.objectContaining({ code: 'ISSUING_SCHOOL_REQUIRED' })] });
    const revokeDb = fakeConn([[/FROM school_transport_certificates\s+WHERE id = \? FOR UPDATE/, [[{
      id: 3, cert_no: 'A/2569-2/0001', school_id: 'A', vehicle_id: 'V1', revoked_at: null,
    }]]], rides]);
    await expect(svc.revokeCertificate(revokeDb, { certificateId: 3, schoolId: 'B', userId: 1, reason: 'ไม่ผ่านเกณฑ์' }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(revokeDb.calls.some((c) => /UPDATE school_transport_certificates/.test(c.sql))).toBe(false);
    const row = { id: 3, cert_no: 'A/2569-2/0001', school_id: 'A', vehicle_id: 'V1', valid_until: '2099-01-01' };
    const viewDb = fakeConn([[/WHERE c\.id = \?/, [[row]]], rides]);
    await expect(svc.getCertificateForViewer(viewDb, { certificateId: 3, viewer: { role: 'school', schoolId: 'B' } }))
      .resolves.toMatchObject({ cert_no: 'A/2569-2/0001' });
    const teacherDb = fakeConn([[/WHERE c\.id = \?/, [[row]]], rides]);
    await expect(svc.getCertificateForViewer(teacherDb, { certificateId: 3, viewer: { role: 'school', schoolId: 'B', gradeScope: 'ป.1' } }))
      .rejects.toMatchObject({ statusCode: 404 });
    const strangerDb = fakeConn([[/WHERE c\.id = \?/, [[row]]], [/SELECT 1 AS ok FROM students/, [[]]]]);
    await expect(svc.getCertificateForViewer(strangerDb, { certificateId: 3, viewer: { role: 'school', schoolId: 'Z' } }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('existing valid certificate is returned, not re-issued', async () => {
    env.features.schoolCertification = true;
    const db = fakeConn([[/c\.revoked_at IS NULL AND c\.valid_until >= \?/, [[{ id: 9, cert_no: 'A/2569-2/0001', valid_until: '2099-01-01' }]]]]);
    const out = await svc.issueCertificateInTx(db.conn, { applicationId: 5, schoolId: 'A', userId: 1 });
    expect(out).toMatchObject({ created: false, certificate: { id: 9, state: 'VALID' } });
  });

  test('appointment: only own school\'s ready applications, date not in the past', async () => {
    env.features.schoolCertification = true;
    const tomorrow = term.addCalendarDays(todayBangkok(), 1);
    const db = fakeConn([
      [/FROM terms/, [[]]],
      [/FROM vehicle_inspection_applications\s+WHERE id IN/, [[
        { id: 1, status: 'READY_TO_PRINT', issuing_school_id: 'A' },
        { id: 2, status: 'READY_TO_PRINT', issuing_school_id: 'B' },
      ]]],
    ]);
    await expect(svc.createAppointment(db, { schoolId: 'A', userId: 1, proposedDate: tomorrow, applicationIds: [1, 2] }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.createAppointment(db, { schoolId: 'A', userId: 1, proposedDate: '2000-01-01', applicationIds: [1] }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('caretaker phone is validated and not written to the audit row', async () => {
    env.features.schoolCertification = true;
    await expect(svc.setCaretaker(fakeConn([]), { vehicleId: 'V1', userId: 1, name: 'ก', phone: '12' }))
      .rejects.toMatchObject({ statusCode: 400 });
    const db = fakeConn([
      [/FOR UPDATE/, [[{ id: 'V1', caretaker_name: null }]]],
      [/UPDATE vehicles SET caretaker_name/, [{ affectedRows: 1 }]],
    ]);
    await svc.setCaretaker(db, { vehicleId: 'V1', userId: 1, name: 'นางดูแล', phone: '081-111-1111' });
    const audit = db.calls.find((c) => /INSERT INTO audit_logs/.test(c.sql));
    expect(JSON.stringify(audit.params)).not.toMatch(/0811111111/);
  });
});

describe('inspection hooks', () => {
  function startDb({ cert = null } = {}) {
    return fakeConn([
      [/FROM vehicle_inspection_applications\s+WHERE id = \?\s+FOR UPDATE/, [[{ id: 5, status: 'READY_TO_PRINT' }]]],
      [/FROM inspection_attempts\s+WHERE application_id = \? AND result = 'IN_PROGRESS'/, [[]]],
      [/c\.revoked_at IS NULL AND c\.valid_until >= \?/, [cert ? [cert] : []]],
      [/FROM inspection_checklist_templates/, [[{ id: 2, version_no: 2 }]]],
      [/INSERT INTO inspection_attempts/, [{ insertId: 50 }]],
      [/UPDATE vehicle_inspection_applications/, [{ affectedRows: 1 }]],
    ]);
  }

  test('flag on: no valid certificate → 409 CERTIFICATE_REQUIRED', async () => {
    env.features.schoolCertification = true;
    const db = startDb();
    await expect(verification.startInspection(db, { applicationId: 5, inspectorUserId: 3 }))
      .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'CERTIFICATE_REQUIRED' }] });
  });

  test('flag on: admin bypasses the certificate gate; v2 checklist ordered first', async () => {
    env.features.schoolCertification = true;
    const db = startDb();
    const out = await verification.startInspection(db, { applicationId: 5, inspectorUserId: 3, isAdmin: true });
    expect(out.attempt_id).toBe(50);
    const tpl = db.calls.find((c) => /FROM inspection_checklist_templates/.test(c.sql));
    expect(tpl.sql).toMatch(/ORDER BY version_no DESC/);
  });

  test('flag off: no certificate query, legacy (v1) checklist preferred', async () => {
    const db = startDb();
    await verification.startInspection(db, { applicationId: 5, inspectorUserId: 3 });
    expect(db.calls.some((c) => /school_transport_certificates/.test(c.sql))).toBe(false);
    const tpl = db.calls.find((c) => /FROM inspection_checklist_templates/.test(c.sql));
    expect(tpl.sql).toMatch(/\(version_no <= 1\) DESC/);
  });

  function finalizeDb() {
    return fakeConn([
      [/FROM inspection_attempts ia\s+JOIN vehicle_inspection_applications a/, [[{
        id: 50, application_id: 5, checklist_template_id: 2, inspected_by: 3, result: 'IN_PROGRESS',
        inspection_date_iso: todayBangkok(), vehicle_id: 'V1', rider_summary_json: '{"peak_rider_count":3}',
      }]]],
      [/FROM inspection_checklist_items/, [[{ id: 1, item_code: 'BRAKES', is_required: 1, allows_na: 0, fail_severity: 'CRITICAL' }]]],
      [/INSERT INTO inspection_checklist_results/, [{}]],
      [/FROM terms/, [[]]],
      [/UPDATE inspection_attempts/, [{ affectedRows: 1 }]],
      [/UPDATE vehicle_inspection_applications/, [{ affectedRows: 1 }]],
      [/INSERT INTO vehicle_inspections/, [{ insertId: 70 }]],
      [/FROM vehicles\s+WHERE id = \?\s+FOR UPDATE/, [[{ id: 'V1', certified_capacity: 10 }]]],
      [/valid_driver_count/, [[{ valid_driver_count: 1 }]]],
      [/FROM school_transport_certificates c\s+WHERE c\.vehicle_id/, [[]]],
      [/UPDATE vehicles/, [{ affectedRows: 1 }]],
    ]);
  }

  test('PASSED after the term end → 400 EXPIRY_AFTER_TERM_END', async () => {
    env.features.schoolCertification = true;
    term.invalidateTermCache();
    const db = finalizeDb();
    await expect(verification.finalizeInspection(db, {
      attemptId: 50, inspectorUserId: 3, result: 'PASSED', expiryDate: '2099-01-01',
      items: [{ item_code: 'BRAKES', result: 'PASS' }],
    })).rejects.toMatchObject({ statusCode: 400, errors: [{ code: 'EXPIRY_AFTER_TERM_END' }] });
    expect(db.conn.rollback).toHaveBeenCalled();
  });

  test('PASSED without expiry defaults to the term end and clears fix_deadline', async () => {
    env.features.schoolCertification = true;
    term.invalidateTermCache();
    const db = finalizeDb();
    const out = await verification.finalizeInspection(db, {
      attemptId: 50, inspectorUserId: 3, result: 'PASSED',
      items: [{ item_code: 'BRAKES', result: 'PASS' }],
    });
    const termId = term.computeTermIdByConvention(todayBangkok());
    expect(out.expiry_date).toBe(term.termEndByConvention(termId));
    const fix = db.calls.find((c) => /SET fix_deadline/.test(c.sql));
    expect(fix.params).toEqual([null, 5]);
  });

  test('NEEDS_FIX sets fix_deadline = today + 15', async () => {
    env.features.schoolCertification = true;
    const db = finalizeDb();
    const out = await verification.finalizeInspection(db, {
      attemptId: 50, inspectorUserId: 3, result: 'NEEDS_FIX',
      items: [{ item_code: 'BRAKES', result: 'FAIL', notes: 'เบรกหลวม' }],
    });
    const expected = term.addCalendarDays(todayBangkok(), 15);
    expect(out.fix_deadline).toBe(expected);
    expect(db.calls.find((c) => /SET fix_deadline/.test(c.sql)).params).toEqual([expected, 5]);
  });

  test('flag off: PASSED still needs a typed expiry and fix_deadline is never touched', async () => {
    await expect(verification.finalizeInspection(finalizeDb(), {
      attemptId: 50, inspectorUserId: 3, result: 'PASSED', items: [],
    })).rejects.toMatchObject({ statusCode: 400, errors: [{ code: 'EXPIRY_DATE_REQUIRED' }] });
    const db = finalizeDb();
    await verification.finalizeInspection(db, {
      attemptId: 50, inspectorUserId: 3, result: 'NEEDS_FIX',
      items: [{ item_code: 'BRAKES', result: 'FAIL', notes: 'x' }],
    });
    expect(db.calls.some((c) => /fix_deadline|school_transport_certificates/.test(c.sql))).toBe(false);
  });
});

describe('pending queues', () => {
  function pqDb(rowsByQueue) {
    const calls = [];
    return {
      calls,
      async query(sql, params) {
        calls.push({ sql, params });
        if (/FROM inspection_appointments ap/.test(sql)) return [rowsByQueue.AP || []];
        if (/FROM school_transport_certificates c/.test(sql)) return [rowsByQueue.CE || []];
        if (/a\.fix_deadline < CURDATE\(\)/.test(sql)) return [rowsByQueue.FX || []];
        if (/SELECT entity_id FROM audit_logs/.test(sql)) return [[]];
        if (/INSERT INTO audit_logs/.test(sql)) return [{ insertId: 1 }];
        return [[]];
      },
    };
  }

  test('flag off: none of the certification queues run', async () => {
    const db = pqDb({});
    await pending.runOnce({ db, dryRun: true });
    expect(db.calls.some((c) => /inspection_appointments|school_transport_certificates|fix_deadline/.test(c.sql))).toBe(false);
  });

  test('fix overdue alerts the school and transport once each; expiring certificates never alert', async () => {
    env.features.schoolCertification = true;
    const db = pqDb({
      FX: [{ item_id: '5', age_s: 3600, school_id: 'A', school_name: 'เอ', affiliation_id: '1', plate_no: 'กข 1', request_no: 'VIA-1', fix_deadline: '2026-11-01' }],
      CE: [{ item_id: '9', age_s: 0, school_id: 'A', school_name: 'เอ', affiliation_id: '1', plate_no: 'กข 1', valid_until: '2026-12-01' }],
    });
    const r = await pending.runOnce({ db, dryRun: true });
    const fx = r.created.filter((a) => a.queue === 'fix_overdue');
    expect(fx.map((a) => a.target.role).sort()).toEqual(['school', 'transport']);
    expect(r.created.some((a) => a.queue === 'certificate_expiring')).toBe(false);
  });

  test('transport summary lists appointment requests; school summary lists expiring certificates', async () => {
    env.features.schoolCertification = true;
    const rows = {
      AP: [{ item_id: '3', age_s: 60, school_id: 'A', school_name: 'เอ', affiliation_id: '1', proposed_date: '2026-12-01', vehicle_count: 4 }],
      CE: [{ item_id: '9', age_s: 0, school_id: 'A', school_name: 'เอ', affiliation_id: '1', plate_no: 'กข 1', valid_until: '2026-12-01' }],
    };
    const t = await pending.getSummary(pqDb(rows), { role: 'transport' }, { detail: true });
    expect(t.queues.find((q) => q.key === 'inspection_appointments').count).toBe(1);
    const s = await pending.getSummary(pqDb(rows), { role: 'school', scopeId: 'A' }, { detail: true });
    expect(s.queues.find((q) => q.key === 'certificate_expiring').count).toBe(1);
  });
});

describe('documents accept the new types only with the flag on', () => {
  const docs = require('../src/services/driverDocuments.service');
  test('ID_CARD / VEHICLE_PHOTO', () => {
    expect(docs.allowedDriverDocTypes()).not.toContain('ID_CARD');
    expect(docs.allowedVehicleDocTypes()).not.toContain('VEHICLE_PHOTO');
    env.features.schoolCertification = true;
    expect(docs.allowedDriverDocTypes()).toContain('ID_CARD');
    expect(docs.allowedVehicleDocTypes()).toContain('VEHICLE_PHOTO');
  });
});

describe('migration 063 + boot guard', () => {
  const root = path.join(__dirname, '..');
  const mig = fs.readFileSync(path.join(root, 'migrations/063_school_transport_certification.sql'), 'utf8');
  test('additive: no DROP / DELETE / TRUNCATE in the forward migration', () => {
    expect(mig).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX)\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
    for (const t of ['school_transport_certificates', 'school_certification_windows',
      'inspection_appointments', 'inspection_appointment_vehicles']) {
      expect(mig).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}`));
    }
    for (const code of ['SCHOOLBUS_SIGN_LIGHT', 'NO_TINT', 'NO_STANDING', 'REAR_GUARD', 'SEAT_LAYOUT', 'EMERGENCY_TOOLS']) {
      expect(mig).toContain(`'${code}'`);
    }
  });
  test('rollback exists and index.js refuses to boot with the flag on and 063 missing', () => {
    expect(fs.existsSync(path.join(root, 'migrations/rollback/063_school_transport_certification_rollback.sql'))).toBe(true);
    const index = fs.readFileSync(path.join(root, 'src/index.js'), 'utf8');
    expect(index).toMatch(/FEATURE_SCHOOL_CERTIFICATION[\s\S]{0,200}063_school_transport_certification\.sql/);
  });
  test('flag defaults off', () => {
    const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
    expect(example).toMatch(/^FEATURE_SCHOOL_CERTIFICATION=false$/m);
    // Production state is recorded separately: on since 2026-11-14 after the
    // owner applied migration 063 (scripts/production-feature-flags.json).
    const flags = JSON.parse(fs.readFileSync(path.join(root, '../scripts/production-feature-flags.json'), 'utf8'));
    expect(flags.flags.schoolCertification.env).toBe('FEATURE_SCHOOL_CERTIFICATION');
  });
});
