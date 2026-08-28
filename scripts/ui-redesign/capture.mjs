#!/usr/bin/env node
/**
 * capture.mjs — Before/After visual QA for the UI redesign.
 *
 * Drives the Vite dev server with Playwright, stubbing every /api/** call with
 * synthetic Thai fixtures. No backend, no database, no production data — the
 * stub intercepts before any request leaves the browser, so reaching the real
 * API is structurally impossible.
 *
 * Beyond screenshots it measures, per capture:
 *   - horizontal overflow (documentElement.scrollWidth vs innerWidth)
 *   - tap targets below 44x44 CSS px
 *   - form inputs below 16px (iOS zoom-on-focus trigger)
 *   - console errors / page errors
 *
 * Usage:
 *   cd frontend && npx vite --port 5173      # terminal 1
 *   node scripts/ui-redesign/capture.mjs --tag before
 *   node scripts/ui-redesign/capture.mjs --tag after
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

// playwright is a dev-only dependency of frontend/ (installed with --no-save),
// so resolve it from there rather than requiring a root-level install.
const { chromium } = createRequire(resolve(root, 'frontend/package.json'))('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const TAG  = (() => { const i = process.argv.indexOf('--tag'); return i === -1 ? 'before' : process.argv[i + 1]; })();
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i === -1 ? null : process.argv[i + 1]; })();
const OUT  = resolve(root, 'outputs/ui-redesign', TAG);
mkdirSync(OUT, { recursive: true });

const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.synthetic.fixture';
const USERS = {
  admin:       { username: 'admin01',       display_name: 'ผู้ดูแลระบบ (ตัวอย่าง)', role: 'admin' },
  province:    { username: 'province01',    display_name: 'จังหวัดลำปาง (ตัวอย่าง)', role: 'province',    scope_type: 'PROVINCE',    scope_id: 'LPG' },
  affiliation: { username: 'affiliation01', display_name: 'สังกัดตัวอย่าง เขต 1',   role: 'affiliation', scope_type: 'AFFILIATION', scope_id: 'AFF001' },
  school:      { username: 'school01',      display_name: 'โรงเรียนตัวอย่าง',       role: 'school',      scope_type: 'SCHOOL',      scope_id: 'SCH0001' },
  transport:   { username: 'transport01',   display_name: 'ขนส่งจังหวัด (ตัวอย่าง)', role: 'transport' },
  driver:      { username: 'driver01',      display_name: 'คนขับ ตัวอย่าง',         role: 'driver',      driver_id: 1 },
};

const VIEWPORTS = {
  mobile:  { width: 390,  height: 844 },
  tablet:  { width: 768,  height: 1024 },
  desktop: { width: 1280, height: 800 },
  wide:    { width: 1920, height: 1080 },
};

// ── Synthetic fixtures (no real people, no real plates, no real schools) ────
const dash = (o = {}) => ({
  total_vehicles: 481, total_students: 4696, total_schools: 317, total_affiliations: 5,
  morning_done: 0, morning_total: 0, morning_pending: 0,
  evening_done: 0, evening_total: 0, evening_pending: 0,
  recent_emergencies: 0, ...o,
});

// Synthetic accounts. Deliberately includes a very long Thai display name and
// a long scope name so column truncation and Thai wrapping get exercised.
const USER_ROWS = [
  { id: 1, username: 'admin01',    display_name: 'ผู้ดูแลระบบ (ตัวอย่าง)',                       role: 'admin',       scope_name: null,                            grade_scope: null,  is_active: true,  must_change_password: false },
  { id: 2, username: 'province01', display_name: 'ผู้ใช้ระดับจังหวัด',                            role: 'province',    scope_name: 'จังหวัดลำปาง',                    grade_scope: null,  is_active: true,  must_change_password: false },
  { id: 3, username: 'aff001',     display_name: 'สังกัดตัวอย่าง เขต 1',                          role: 'affiliation', scope_name: 'สังกัดตัวอย่าง เขต 1',            grade_scope: null,  is_active: true,  must_change_password: true  },
  { id: 4, username: 'school0001', display_name: 'โรงเรียนตัวอย่างที่มีชื่อยาวมากเพื่อทดสอบการตัดข้อความ', role: 'school', scope_name: 'โรงเรียนตัวอย่างชื่อยาวมาก', grade_scope: 'ป.4', is_active: true,  must_change_password: false },
  { id: 5, username: 'driver042',  display_name: 'คนขับ ตัวอย่าง',                                role: 'driver',      scope_name: null,                            grade_scope: null,  is_active: false, must_change_password: false },
  { id: 6, username: 'transport1', display_name: 'ขนส่งจังหวัด (ตัวอย่าง)',                        role: 'transport',   scope_name: null,                            grade_scope: null,  is_active: true,  must_change_password: false },
];

const SCHOOL_ROWS = [
  { id: 'SCH0001', name: 'โรงเรียนตัวอย่างที่มีชื่อยาวมากเพื่อทดสอบการตัดข้อความในคอลัมน์', affiliation_name: 'สังกัดตัวอย่าง เขต 1', student_count: 1284, vehicle_count: 42 },
  { id: 'SCH0002', name: 'โรงเรียนตัวอย่าง ข',  affiliation_name: 'สังกัดตัวอย่าง เขต 2', student_count: 96,   vehicle_count: 4 },
  { id: 'SCH0003', name: 'โรงเรียนตัวอย่าง ค',  affiliation_name: 'สังกัดตัวอย่าง เขต 1', student_count: 0,    vehicle_count: 0 },
];

const AFFILIATION_ROWS = [
  { id: 'AFF001', name: 'สังกัดตัวอย่าง เขต 1', school_count: 128, student_count: 12840, vehicle_count: 421, morning_kpi: 98.4, evening_kpi: 97.9, morning_done: 12640, morning_expected: 12840, evening_done: 12570, evening_expected: 12840, emergency_count: 0 },
  { id: 'AFF002', name: 'สังกัดตัวอย่าง เขต 2', school_count: 96,  student_count: 8420,  vehicle_count: 260, morning_kpi: 88.1, evening_kpi: 86.5, morning_done: 7418,  morning_expected: 8420,  evening_done: 7283,  evening_expected: 8420,  emergency_count: 2 },
  { id: 'AFF003', name: 'สังกัดตัวอย่าง เขต 3', school_count: 44,  student_count: 3120,  vehicle_count: 98,  morning_kpi: 62.0, evening_kpi: 60.4, morning_done: 1934,  morning_expected: 3120,  evening_done: 1885,  evening_expected: 3120,  emergency_count: 5 },
];

const VEHICLE_ROWS = [
  { id: 1, plate_no: 'กข-1111 ลำปาง', vehicle_type: 'รถตู้',        school_names: 'โรงเรียนตัวอย่าง ก', student_count: 18, driver_name: 'คนขับ ตัวอย่าง ก', attendant_name: 'ผู้ดูแล ตัวอย่าง', owner_name: 'เจ้าของ ตัวอย่าง', latest_inspection_result: 'PASSED',    insurance_expiry: '2027-03-01' },
  { id: 2, plate_no: 'กข-2222 ลำปาง', vehicle_type: 'รถสองแถว',     school_names: 'โรงเรียนตัวอย่าง ข', student_count: 24, driver_name: 'คนขับ ตัวอย่าง ข', attendant_name: '-',              owner_name: 'เจ้าของ ตัวอย่าง', latest_inspection_result: 'NEEDS_FIX', insurance_expiry: '2026-09-01' },
  { id: 3, plate_no: 'กข-3333 ลำปาง', vehicle_type: 'รถบัสขนาดเล็ก', school_names: 'โรงเรียนตัวอย่าง ค', student_count: 0,  driver_name: '-',               attendant_name: '-',              owner_name: '-',                latest_inspection_result: null,       insurance_expiry: null },
];

const TRANSFER_ROWS = [
  { id: 101, created_at: '2026-08-25T02:10:00Z', student_name: 'นักเรียน ตัวอย่าง ก', student_code: 'STU00001', source_school_name: 'โรงเรียนตัวอย่าง ก', destination_school_name: 'โรงเรียนตัวอย่าง ข', reason: 'ย้ายตามที่อยู่ผู้ปกครอง', status: 'PENDING' },
  { id: 102, created_at: '2026-08-24T07:40:00Z', student_name: 'นักเรียน ตัวอย่าง ข', student_code: 'STU00002', source_school_name: 'โรงเรียนตัวอย่าง ค', destination_school_name: 'โรงเรียนตัวอย่าง ก', reason: 'เหตุผลที่ยาวมากเพื่อทดสอบการตัดข้อความในคอลัมน์เหตุผลของตาราง', status: 'PENDING' },
];

const VEH_REQ_ROWS = [
  { id: 201, created_at: '2026-08-25T03:00:00Z', request_type: 'RESTORE_SOFT_DELETED_VEHICLE', school_name: 'โรงเรียนตัวอย่าง ก', input_plate: 'กข-1111 ลำปาง', import_batch_id: 42, status: 'PENDING' },
  { id: 202, created_at: '2026-08-24T05:00:00Z', request_type: 'USE_EXISTING_SHARED_VEHICLE',  school_name: 'โรงเรียนตัวอย่างที่มีชื่อยาวมาก', input_plate: 'กข-2222 ลำปาง', import_batch_id: null, status: 'PENDING' },
];

const AFF_TRANSFER_ROWS = [
  { id: 301, created_at: '2026-08-25T01:00:00Z', student_name_snapshot: 'นักเรียน ตัวอย่าง ก', student_code: 'STU00001', source_school_name: 'โรงเรียนตัวอย่าง ก', destination_school_name: 'โรงเรียนตัวอย่าง ข', status: 'PENDING' },
  { id: 302, created_at: '2026-08-23T01:00:00Z', student_name_snapshot: 'นักเรียน ตัวอย่าง ข', student_code: 'STU00002', source_school_name: 'โรงเรียนตัวอย่าง ค', destination_school_name: 'โรงเรียนตัวอย่าง ก', status: 'APPLIED' },
];

// Synthetic pupils. No real names, codes, schools or plates.
const STUDENT_ROWS = [
  { id: 90001, prefix: 'ด.ช.', first_name: 'นักเรียน', last_name: 'ตัวอย่าง ก', grade: 'ป.4', classroom: '2', school_name: 'โรงเรียนตัวอย่าง ก', affiliation_name: 'สังกัดตัวอย่าง เขต 1', plate_no: 'กข-1111 ลำปาง', morning_enabled: true,  evening_enabled: true  },
  { id: 90002, prefix: 'ด.ญ.', first_name: 'นักเรียน', last_name: 'ตัวอย่าง ข', grade: 'ม.1', classroom: '1', school_name: 'โรงเรียนตัวอย่างที่มีชื่อยาวมากเพื่อทดสอบ', affiliation_name: 'สังกัดตัวอย่าง เขต 2', plate_no: 'กข-2222 ลำปาง', morning_enabled: true,  evening_enabled: false },
  { id: 90003, prefix: 'ด.ช.', first_name: 'นักเรียน', last_name: 'ตัวอย่าง ค', grade: 'อ.2', classroom: null, school_name: 'โรงเรียนตัวอย่าง ค', affiliation_name: 'สังกัดตัวอย่าง เขต 1', plate_no: null, morning_enabled: false, evening_enabled: false },
];

const AUDIT_ROWS = [
  { id: 1, created_at: '2026-08-26T02:30:00Z', actor_name: 'admin01',    action: 'UPDATE',  entity_type: 'vehicle', entity_id: 'V-002',   old_value: { plate_no: 'กข-2210 ลำปาง' }, new_value: { plate_no: 'กข-2211 ลำปาง' } },
  { id: 2, created_at: '2026-08-26T01:15:00Z', actor_name: 'school0001', action: 'IMPORT',  entity_type: 'student', entity_id: null,      new_value: { success: 28, errors: 2 } },
  { id: 3, created_at: '2026-08-25T09:42:00Z', actor_name: 'admin01',    action: 'DELETE',  entity_type: 'student', entity_id: 'STU-099', old_value: { first_name: 'นักเรียน', last_name: 'ตัวอย่าง' } },
  { id: 4, created_at: '2026-08-25T08:05:00Z', actor_name: 'province01', action: 'EXPORT',  entity_type: 'checkin', entity_id: null,      new_value: { format: 'csv', rows: 1240 } },
  { id: 5, created_at: '2026-08-25T07:50:00Z', actor_name: 'driver042',  action: 'LOGIN',   entity_type: 'user',    entity_id: null,      new_value: {} },
];

// One import batch's detail, covering every branch the modal renders: a plain
// applied row, a guardian mismatch awaiting confirmation, a soft-deleted pupil
// awaiting reactivation, a hard error, and a rolled-back row.
const IMPORT_DETAIL = { data: {
  batch: { id: 'B-2', filename: 'students-aug.csv' },
  summary: { total: 5, applied: 2, warning: 2, error: 1, rolled_back: 1, ready: 1 },
  rows: [
    { row_number: 1, student_code: '52020001', student_name: 'ด.ช. นักเรียน ทดสอบหนึ่ง', classification: 'INSERT_NEW',        status: 'APPLIED',  message_th: 'นำเข้าสำเร็จ',            can_rollback: true,  can_apply: false, can_confirm_guardian_update: false, can_confirm_reactivate: false, rollback_status: null, input_vehicle_plate: 'กข-1111 ลำปาง', matched_display_plate: 'กข-1111 ลำปาง' },
    { row_number: 2, student_code: '52020002', student_name: 'ด.ญ. นักเรียน ทดสอบสอง', classification: 'GUARDIAN_MISMATCH',  status: 'WARNING',  message_th: 'ข้อมูลผู้ปกครองไม่ตรงกับในระบบ', can_rollback: false, can_apply: false, can_confirm_guardian_update: true,  can_confirm_reactivate: false, rollback_status: null, guardian_mismatch: true, guardian_current: 'ผู้ปกครอง เดิม', guardian_input: 'ผู้ปกครอง ใหม่', input_vehicle_plate: 'กข-1111 ลำปาง', matched_display_plate: 'กข-1111 ลำปาง' },
    { row_number: 3, student_code: '52020003', student_name: 'ด.ช. นักเรียน ทดสอบสาม', classification: 'SOFT_DELETED_SAME_SCHOOL_REACTIVATE', status: 'WARNING', message_th: 'เคยถูกลบ ต้องยืนยันกู้คืน', can_rollback: false, can_apply: false, can_confirm_guardian_update: false, can_confirm_reactivate: true, rollback_status: null, action_required: 'ยืนยันกู้คืนนักเรียน', input_vehicle_plate: 'กข-2222 ลำปาง', matched_display_plate: 'กข-2222 ลำปาง' },
    { row_number: 4, student_code: 'BAD',      student_name: null,                        classification: 'VEHICLE_SOFT_DELETED', status: 'ERROR', message_th: 'รถถูกปิดใช้งาน',      can_rollback: false, can_apply: false, can_confirm_guardian_update: false, can_confirm_reactivate: false, rollback_status: null, input_vehicle_plate: 'กข-9999 ลำปาง', matched_display_plate: null },
    { row_number: 5, student_code: '52020005', student_name: 'ด.ญ. นักเรียน ทดสอบห้า',  classification: 'INSERT_NEW',        status: 'APPLIED',  message_th: 'ย้อนกลับแล้ว',           can_rollback: false, can_apply: false, can_confirm_guardian_update: false, can_confirm_reactivate: false, rollback_status: 'ROLLED_BACK', input_vehicle_plate: 'กข-1111 ลำปาง', matched_display_plate: 'กข-1111 ลำปาง' },
  ],
} };

// Synthetic pickup fixtures. Names and plates are invented for this harness;
// no production record is used.
const PICKUP_POINTS = [
  { id: 'PP-1', label: 'หน้าโรงเรียนบ้านตัวอย่าง', latitude: 18.2888, longitude: 99.4908, session: 'both',    notes: 'จอดฝั่งซ้าย',  vehicle_id: 'V-1', plate_no: 'กข-1111 ลำปาง', student_count: 6 },
  { id: 'PP-2', label: 'ปาก ซ.5 ถนนตัวอย่าง',      latitude: 18.2931, longitude: 99.4972, session: 'morning', notes: '',              vehicle_id: 'V-1', plate_no: 'กข-1111 ลำปาง', student_count: 3 },
  { id: 'PP-3', label: 'ตลาดสดตัวอย่าง',            latitude: 18.2802, longitude: 99.4855, session: 'evening', notes: '',              vehicle_id: 'V-2', plate_no: 'กข-2222 ลำปาง', student_count: 4 },
];
const PICKUP_STUDENTS = [
  { id: 'S-1', prefix: 'ด.ช.', first_name: 'นักเรียน', last_name: 'ทดสอบหนึ่ง', grade: 'ป.4', classroom: '1' },
  { id: 'S-2', prefix: 'ด.ญ.', first_name: 'นักเรียน', last_name: 'ทดสอบสอง',  grade: 'ป.4', classroom: '2' },
  { id: 'S-3', prefix: 'ด.ช.', first_name: 'นักเรียน', last_name: 'ทดสอบสาม',  grade: 'ป.5', classroom: '1' },
];
const PICKUP_VEHICLES = [
  { id: 'V-1', plate_no: 'กข-1111 ลำปาง', student_count: 9 },
  { id: 'V-2', plate_no: 'กข-2222 ลำปาง', student_count: 4 },
];

// Synthetic research fixtures — invented numbers, no production record.
const SNAP_METRICS = {
  total_students: 1240, students_with_vehicle: 1102, students_with_parent: 998,
  total_vehicles: 186, vehicles_with_insurance: 171, vehicles_inspected: 160,
  vehicles_passed: 152, morning_total: 186, morning_done: 174,
  evening_total: 186, evening_done: 168, active_users: 276, total_users: 312,
  emergency_count: 0,
};
const EVAL_SUMMARY = {
  baseline: { date: '2026-01-08', data: { ...SNAP_METRICS, students_with_vehicle: 940, vehicles_inspected: 121 } },
  latest:   { date: '2026-08-25', data: SNAP_METRICS },
  role_actions: {
    driver:      { total: 42, actions: { LOGIN: 20, UPDATE: 14, CREATE: 8 } },
    school:      { total: 24, actions: { IMPORT: 6, UPDATE: 12, EXPORT: 6 } },
    affiliation: { total: 9,  actions: { LOGIN: 5, EXPORT: 4 } },
    province:    { total: 31, actions: { LOGIN: 12, EXPORT: 19 } },
    transport:   { total: 3,  actions: { LOGIN: 3 } },
    admin:       { total: 58, actions: { LOGIN: 22, UPDATE: 20, DELETE: 4, EXPORT: 12 } },
  },
  role_exports: { driver: 0, school: 6, affiliation: 4, province: 19, transport: 0, admin: 12 },
};

const SCENARIOS = {
  // round not started — the case the old UI wrongly showed as a big warning
  normal: {
    '/api/province/dashboard': { data: dash({ morning_done: 3980, morning_total: 4654, evening_total: 4651, morning_pending: 674 }) },
    '/api/admin/users':                 { data: USER_ROWS, meta: { page: 1, per_page: 50, total: 276 } },
    '/api/admin/users?is_active=false': { data: [], meta: { page: 1, per_page: 5, total: 643 } },
    '/api/admin/users-needing-action': { data: { total: 643, rows: [
      { id: 101, username: 'user-a', display_name: 'ผู้ใช้ตัวอย่าง ก', is_active: true,  must_change_password: true },
      { id: 102, username: 'user-b', display_name: 'ผู้ใช้ตัวอย่าง ข', is_active: true,  must_change_password: true },
      { id: 103, username: 'user-c', display_name: 'ผู้ใช้ตัวอย่าง ค', is_active: false, must_change_password: false },
    ] } },
    '/api/admin/roster-requests-pending': { data: { total: 0, rows: [] } },
    '/api/admin/audit-logs': { data: AUDIT_ROWS, meta: { page: 1, per_page: 30, total: 1284 } },
    '/api/province/schools':      { data: SCHOOL_ROWS, meta: { page: 1, per_page: 50, total: 317 } },
    '/api/province/affiliations': { data: AFFILIATION_ROWS },
    '/api/province/vehicles':     { data: VEHICLE_ROWS },
    '/api/affiliation/vehicles':  { data: VEHICLE_ROWS, meta: { page: 1, per_page: 50, total: 3 } },
    '/api/school/vehicles':       { data: VEHICLE_ROWS, meta: { page: 1, per_page: 50, total: 3 } },
    '/api/transport/vehicles':    { data: VEHICLE_ROWS, meta: { page: 1, per_page: 50, total: 3 } },
    '/api/admin/student-transfer-requests': { data: TRANSFER_ROWS },
    '/api/admin/vehicle-requests': { data: VEH_REQ_ROWS },
    '/api/affiliation/transfer-requests': { data: AFF_TRANSFER_ROWS },
    '/api/affiliation/vehicle-requests':  { data: VEH_REQ_ROWS },
    '/api/province/students':    { data: STUDENT_ROWS, meta: { page: 1, per_page: 50, total: 4696 } },
    '/api/affiliation/schools':  { data: SCHOOL_ROWS },
    '/api/school/students':      { data: STUDENT_ROWS, meta: { page: 1, per_page: 20, total: 1284 } },
    '/api/school/vehicles/all':  { data: VEHICLE_ROWS },
    '/api/affiliation/students': { data: STUDENT_ROWS, meta: { page: 1, per_page: 50, total: 1284 } },
  },
  // everything quiet — verifies empty cards collapse instead of standing tall
  zero: {
    '/api/province/dashboard': { data: dash() },
    '/api/admin/users':                 { data: [], meta: { total: 276 } },
    '/api/admin/users?is_active=false': { data: [], meta: { total: 0 } },
    '/api/admin/users-needing-action': { data: { total: 0, rows: [] } },
    '/api/admin/roster-requests-pending': { data: { total: 0, rows: [] } },
    '/api/admin/audit-logs': { data: [], meta: { total: 0 } },
  },
  // large numbers — verifies tabular-nums alignment and no layout break
  large: {
    '/api/province/dashboard': { data: dash({
      total_vehicles: 128450, total_students: 1284560, total_schools: 12840,
      morning_done: 1180450, morning_total: 1284560, morning_pending: 104110,
      evening_done: 990120, evening_total: 1284560, evening_pending: 294440,
      recent_emergencies: 128,
    }) },
    '/api/admin/users':                 { data: [], meta: { total: 986420 } },
    '/api/admin/users?is_active=false': { data: [], meta: { total: 12480 } },
    '/api/admin/users-needing-action': { data: { total: 12480, rows: [
      { id: 1, display_name: 'ชื่อผู้ใช้ที่ยาวมากเพื่อทดสอบการตัดบรรทัดภาษาไทยในการ์ด', is_active: false, must_change_password: false },
    ] } },
    '/api/admin/roster-requests-pending': { data: { total: 8934, rows: [
      { id: 1, school_name: 'โรงเรียนตัวอย่างที่มีชื่อยาวมากเพื่อทดสอบ', request_type: 'add', created_at: '2026-08-26T01:00:00Z' },
    ] } },
    '/api/admin/audit-logs': { data: [
      { id: 1, actor_name: 'ผู้ใช้ตัวอย่าง', entity_type: 'student', created_at: '2026-08-26T02:00:00Z' },
    ], meta: { total: 4210 } },
  },
  // every call fails — dashboard must degrade, not blank out
  error: { __ALL_FAIL__: true },

  // บัญชีคนขับที่ยังไม่ผูกกับรถ (`driver_id` ว่าง) — พบจริงบน production
  // 27 ส.ค. 2569 บัญชีแบบนี้เคยติดกับดัก: PretripModal ที่ปิดไม่ได้เปิดขึ้นมา
  // แล้วทุกปุ่มในนั้นล้มเหลวด้วยเหตุเดียวกัน ออกจากหน้าไม่ได้เลย
  // หน้าต้องอธิบายสาเหตุเป็นภาษาไทย ไม่ใช่ปล่อยข้อความอังกฤษดิบหรือเปิดโมดัลค้าง
  // สถานะจริงที่วัดจาก production: 4 เส้นทางตอบ 400 พร้อมข้อความอังกฤษ
  // อีก 2 เส้นทางตอบ 409 พร้อมข้อความไทย — ความไม่สม่ำเสมอนี้จำลองไว้ตามจริง
  driver_unlinked: {
    '/api/driver/pretrip-status':      { __status: 400, message: 'Vehicle not found for this driver account' },
    '/api/driver/status-today':        { __status: 400, message: 'Vehicle not found for this driver account' },
    '/api/driver/roster':              { __status: 400, message: 'Vehicle not found for this driver account' },
    '/api/driver/profile':             { __status: 400, message: 'Vehicle not found for this driver account' },
    '/api/driver/authorized-vehicles': { __status: 409, message: 'บัญชีนี้ยังไม่เชื่อมกับข้อมูลคนขับ' },
    '/api/driver/active-shift':        { __status: 409, message: 'บัญชีนี้ยังไม่เชื่อมกับข้อมูลคนขับ' },
  },
};

// ── การตรวจรับรองรถของขนส่ง — ใช้ทดสอบขั้นตอนที่ "เขียนข้อมูล" ────────────
// รูปทรงข้อมูลลอกจาก production จริง (ตรวจเมื่อ 27 ส.ค. 2569) เพื่อให้ flow
// เริ่มตรวจ → ลงรายการ → ยกเลิก เดินได้เหมือนของจริงโดยไม่แตะฐานข้อมูลจริง
const VERIFY_QUEUE = [
  { id: 9001, request_no: 'VIA-20260827-TEST01', vehicle_id: 1, plate_no: 'กข-1111 ลำปาง',
    vehicle_type: 'รถตู้', status: 'READY_TO_PRINT', verification_status: 'UNVERIFIED',
    issuing_school_name: 'โรงเรียนตัวอย่าง ก', certified_capacity: null,
    peak_rider_count: 12, morning_rider_count: 12, evening_rider_count: 11,
    schools: [{ school_id: 11, school_name: 'โรงเรียนตัวอย่าง ก', morning_rider_count: 12, evening_rider_count: 11, peak_rider_count: 12 }],
    routes: [], drivers: [] },
  { id: 9002, request_no: 'VIA-20260827-TEST02', vehicle_id: 2, plate_no: 'กข-2222 ลำปาง',
    vehicle_type: 'รถสองแถว', status: 'READY_TO_PRINT', verification_status: 'UNVERIFIED',
    issuing_school_name: 'โรงเรียนตัวอย่าง ข', certified_capacity: null,
    peak_rider_count: 20, morning_rider_count: 20, evening_rider_count: 20,
    schools: [{ school_id: 12, school_name: 'โรงเรียนตัวอย่าง ข', morning_rider_count: 20, evening_rider_count: 20, peak_rider_count: 20 }],
    routes: [], drivers: [] },
];

// สถานะจำลองของการตรวจ 1 ครั้ง — จำเป็นเพราะหน้าอ่าน attempts จาก detail
// *หลัง* กดเริ่มตรวจ ถ้า mock ไร้สถานะ ขั้นตอนนี้จะทดสอบไม่ได้เลย
// รีเซ็ตทุกครั้งที่เปิดหน้าใหม่ (ดู newPage) เพื่อไม่ให้ capture รบกวนกัน
let inspectionAttempt = null;
export function resetInspectionState() { inspectionAttempt = null; }

const CHECKLIST_TEMPLATE = {
  template_name: 'รายการตรวจสภาพรถรับส่งนักเรียน', version_no: 3,
  items: [
    { item_code: 'BRAKE',  category: 'ระบบความปลอดภัย', label_th: 'ระบบเบรก' },
    { item_code: 'TIRE',   category: 'ระบบความปลอดภัย', label_th: 'สภาพยางและลมยาง' },
    { item_code: 'BELT',   category: 'ระบบความปลอดภัย', label_th: 'เข็มขัดนิรภัยครบทุกที่นั่ง' },
    { item_code: 'LIGHT',  category: 'อุปกรณ์ไฟ',       label_th: 'ไฟหน้า ไฟท้าย ไฟเลี้ยว' },
    { item_code: 'EXIT',   category: 'ทางออกฉุกเฉิน',   label_th: 'ประตูและทางออกฉุกเฉิน' },
  ],
};

const VERIFY_DRIVERS = [
  { driver_id: 501, name: 'คนขับ ทดสอบหนึ่ง', license_no: null, license_expiry: null },
  { driver_id: 502, name: 'คนขับ ทดสอบสอง', license_no: null, license_expiry: null },
];

// Endpoints shared by every scenario. The pickup editors are the same form on
// two roles; both need points, pupils and (for the school) vehicles before the
// editor can be opened at all.
/* รายชื่อนักเรียนของคนขับ — ชื่อสมมติล้วน ใช้กับหน้าเช็กชื่อซึ่งเป็นภาพหลัก
   ในคู่มือคนขับ ถ้าไม่มี fixture นี้ หน้าจะขึ้น "ยังไม่มีนักเรียนในรถคันนี้"
   แล้วครูจะไม่เห็นสิ่งที่ต้องกดจริง ๆ ตอนใช้งาน
   สถานะจงใจให้ปนกัน: ขึ้นรถแล้ว / ยังไม่ขึ้น / ลา — ครอบคลุมทุกแบบที่คนขับเจอ */
const DRIVER_ROSTER = {
  vehicle: { id: 1, plate_no: 'กข-1111 ลำปาง', vehicle_type: 'รถตู้' },
  students: [
    { id: 501, first_name: 'ก',   last_name: 'ตัวอย่างหนึ่ง', grade: 'ป.3', classroom: '2', school_name: 'โรงเรียนตัวอย่าง ก', morning_done: 1, evening_done: 0, leave_session: null },
    { id: 502, first_name: 'ข',   last_name: 'ตัวอย่างสอง',  grade: 'ป.3', classroom: '2', school_name: 'โรงเรียนตัวอย่าง ก', morning_done: 1, evening_done: 0, leave_session: null },
    { id: 503, first_name: 'ค',   last_name: 'ตัวอย่างสาม',  grade: 'ป.5', classroom: '1', school_name: 'โรงเรียนตัวอย่าง ก', morning_done: 0, evening_done: 0, leave_session: null },
    { id: 504, first_name: 'ง',   last_name: 'ตัวอย่างสี่',   grade: 'ป.6', classroom: '3', school_name: 'โรงเรียนตัวอย่าง ข', morning_done: 0, evening_done: 0, leave_session: 'morning' },
    { id: 505, first_name: 'จ',   last_name: 'ตัวอย่างห้า',   grade: 'ม.1', classroom: '1', school_name: 'โรงเรียนตัวอย่าง ข', morning_done: 0, evening_done: 0, leave_session: null },
  ],
};

/* แดชบอร์ดรายบทบาท — จำนวนถูกตั้งให้ "มีงานค้างอยู่บ้าง" ไม่ใช่ศูนย์และไม่ใช่
   เสร็จครบ เพราะภาพในคู่มือควรแสดงสภาพวันทำงานจริงที่ครูจะเจอ */
const SCHOOL_DASH = {
  school: { id: 'SCH0001', name: 'โรงเรียนตัวอย่าง ก', affiliation_name: 'สังกัดตัวอย่าง เขต 1' },
  date: '2026-08-27',
  total_students: 128, total_vehicles: 10,
  morning_total: 128, morning_done: 121, morning_pending: 7, morning_leave: 1,
  evening_total: 128, evening_done: 96, evening_pending: 32, evening_leave: 1,
  recent_emergencies: 0,
  // ต้องครบทั้ง 6 field — SchoolDashboard หารทีละคู่แล้วเฉลี่ย ถ้าขาดตัวใด
  // ตัวหนึ่งผลลัพธ์กลายเป็น NaN แล้วหน้าจะขึ้น 'NaN% ครบถ้วน'
  completeness: {
    students_total: 128, students_with_vehicle: 118, students_with_parent: 96,
    vehicles_total: 10, vehicles_inspected: 9, vehicles_insured: 10,
  },
};
const AFFILIATION_DASH = { ...dash({
  total_schools: 42, total_students: 1284, total_vehicles: 96, total_affiliations: 1,
  morning_total: 1284, morning_done: 1180, morning_pending: 104,
  evening_total: 1284, evening_done: 902, evening_pending: 382,
}) };
// field ต้องตรงกับที่ TransportDashboard อ่าน — ถ้า total_vehicles หายไป
// หน้าจะขึ้น 'ยังไม่มีรถในระบบ' ทั้งที่รายการข้างล่างแสดงรถอยู่
const TRANSPORT_DASH = {
  total_vehicles: 481,
  passed: 402, not_inspected: 54, needs_fix: 21, failed: 4,
  insurance_ok: 438, no_insurance_data: 19, expired_insurance: 8, expiring_insurance: 16,
  expiring_docs_count: 23, expired_docs_count: 6,
};
const STATUS_TODAY = {
  date: '2026-08-27',
  // SchoolOverrideModal consumes vehicles[].students — the inverted "tick who
  // did NOT board" picker is driven entirely from this shape, so the fixture
  // has to carry one pupil of each state the picker branches on.
  vehicles: [
    { vehicle_id: 1, plate_no: 'กข-1111 ลำปาง', students: [
      { id: 501, name: 'ด.ช.นักเรียน ตัวอย่าง ก', grade: 'ป.3', classroom: '2',
        morning_enabled: true, evening_enabled: true, morning_done: false, evening_done: false, leave_session: null },
      { id: 502, name: 'ด.ญ.นักเรียน ตัวอย่าง ข', grade: 'ป.3', classroom: '2',
        morning_enabled: true, evening_enabled: true, morning_done: false, evening_done: false, leave_session: null },
      { id: 503, name: 'ด.ช.นักเรียน ตัวอย่าง ค', grade: 'ป.5', classroom: '1',
        morning_enabled: true, evening_enabled: true, morning_done: true,  evening_done: false, leave_session: null },
      { id: 504, name: 'ด.ญ.นักเรียน ตัวอย่าง ง', grade: 'ป.6', classroom: '3',
        morning_enabled: true, evening_enabled: true, morning_done: false, evening_done: false, leave_session: 'morning' },
    ] },
    { vehicle_id: 2, plate_no: 'กข-2222 ลำปาง', students: [
      { id: 505, name: 'ด.ช.นักเรียน ตัวอย่าง จ', grade: 'ม.1', classroom: '1',
        morning_enabled: false, evening_enabled: true, morning_done: false, evening_done: false, leave_session: null },
    ] },
  ],
  rows: [
    { vehicle_id: 1, plate_no: 'กข-1111 ลำปาง', driver_name: 'คนขับ ตัวอย่าง ก', school_name: 'โรงเรียนตัวอย่าง ก', morning_total: 9, morning_done: 9, evening_total: 9, evening_done: 8 },
    { vehicle_id: 2, plate_no: 'กข-2222 ลำปาง', driver_name: 'คนขับ ตัวอย่าง ข', school_name: 'โรงเรียนตัวอย่าง ก', morning_total: 4, morning_done: 3, evening_total: 4, evening_done: 4 },
    { vehicle_id: 3, plate_no: 'กข-3333 ลำปาง', driver_name: '-',              school_name: 'โรงเรียนตัวอย่าง ข', morning_total: 0, morning_done: 0, evening_total: 0, evening_done: 0 },
  ],
};
const LIVE_VEHICLES = { vehicles: [
  { vehicle_id: 1, plate_no: 'กข-1111 ลำปาง', driver_name: 'คนขับ ตัวอย่าง ก', latitude: 18.2888, longitude: 99.4908, recorded_at: '2026-08-27T09:12:00+07:00', is_stale: false, students_onboard: 9 },
  { vehicle_id: 2, plate_no: 'กข-2222 ลำปาง', driver_name: 'คนขับ ตัวอย่าง ข', latitude: 18.2801, longitude: 99.5012, recorded_at: '2026-08-27T09:10:00+07:00', is_stale: false, students_onboard: 3 },
] };
const LEAVES = [
  { id: 11, student_id: 504, student_name: 'ง ตัวอย่างสี่', grade: 'ป.6', classroom: '3', leave_session: 'morning', leave_date: '2026-08-27', reason: 'ผู้ปกครองมารับเอง', recorded_by: 'ครูตัวอย่าง' },
];
const EMERGENCIES = [
  { id: 3, vehicle_id: 2, plate_no: 'กข-2222 ลำปาง', driver_name: 'คนขับ ตัวอย่าง ข', kind: 'breakdown', note: 'ยางรั่วระหว่างทาง (ตัวอย่าง)', created_at: '2026-08-26T07:41:00+07:00', resolved_at: '2026-08-26T08:05:00+07:00' },
];
const AUDIT_ROWS_GENERIC = { data: AUDIT_ROWS, meta: { page: 1, per_page: 30, total: 1284 } };

const COMMON = {
  '/api/driver/roster':         { data: DRIVER_ROSTER },
  '/api/driver/pretrip-status': { data: { done: false } },
  '/api/driver/status-today':   { data: { current_session: 'evening', summary: { total: 5, boarded: 2, remaining: 3 } } },
  '/api/driver/vehicle-location': { data: { latitude: 18.2888, longitude: 99.4908, recorded_at: '2026-08-27T09:12:00+07:00', is_sending: false } },
  '/api/driver/profile':        { data: { id: 1, name: 'คนขับ ตัวอย่าง', phone: '0800000000', plate_no: 'กข-1111 ลำปาง', vehicle_type: 'รถตู้', line_linked: false } },
  '/api/driver/schools':        { data: SCHOOL_ROWS },
  '/api/driver/roster-requests': { data: [
    { id: 5, school_name: 'โรงเรียนตัวอย่าง ก', status: 'PENDING', student_count: 2, created_at: '2026-08-26T10:00:00+07:00' },
    { id: 4, school_name: 'โรงเรียนตัวอย่าง ข', status: 'APPROVED', student_count: 1, created_at: '2026-08-20T10:00:00+07:00' },
  ] },

  '/api/school/dashboard':      { data: SCHOOL_DASH },
  '/api/school/status-today':   { data: STATUS_TODAY },
  '/api/school/leaves':         { data: LEAVES },
  '/api/school/emergencies':    { data: EMERGENCIES },
  '/api/school/live-vehicles':  { data: LIVE_VEHICLES },
  '/api/school/audit-logs':     AUDIT_ROWS_GENERIC,
  '/api/school/teacher-accounts': { data: [
    { id: 21, username: 'teacher-p4', display_name: 'ครูตัวอย่าง ป.4', grade_scope: 'ป.4', is_active: true, must_change_password: true },
    { id: 22, username: 'teacher-p5', display_name: 'ครูตัวอย่าง ป.5', grade_scope: 'ป.5', is_active: true, must_change_password: false },
  ] },
  '/api/school/roster-requests': { data: [
    { id: 9, driver_name: 'คนขับ ตัวอย่าง ก', plate_no: 'กข-1111 ลำปาง', student_count: 2, status: 'PENDING', created_at: '2026-08-26T10:00:00+07:00' },
  ] },
  '/api/school/registrations':  { data: [
    { id: 7, plate_no: 'กข-4444 ลำปาง', owner_name: 'เจ้าของ ตัวอย่าง', driver_name: 'คนขับ ตัวอย่าง ง', status: 'PENDING', submitted_at: '2026-08-25T09:00:00+07:00' },
  ] },
  '/api/verification/school/applications': { data: [
    { id: 12, plate_no: 'กข-2222 ลำปาง', status: 'NEEDS_FIX', submitted_at: '2026-08-24T09:00:00+07:00', reasons: ['ประกันภัยหมดอายุ'] },
  ] },

  '/api/affiliation/dashboard':     { data: AFFILIATION_DASH },
  '/api/affiliation/status-today':  { data: STATUS_TODAY },
  '/api/affiliation/emergencies':   { data: EMERGENCIES },
  '/api/affiliation/live-vehicles': { data: LIVE_VEHICLES },
  '/api/affiliation/pickup-map':    { data: PICKUP_POINTS },
  '/api/affiliation/audit-logs':    AUDIT_ROWS_GENERIC,
  '/api/affiliation/vehicles-at-risk': { data: [
      // field ต้องตรงกับที่ VehicleAtRiskRow ใช้ — key={v.id} ถ้าไม่มี id
    // React จะเตือน duplicate key และ gate จะจับได้
    { id: 2, plate_no: 'กข-2222 ลำปาง', driver_name: 'คนขับ ตัวอย่าง ข', student_count: 4,
      school_names: 'โรงเรียนตัวอย่าง ก', risk_reasons: ['ประกันภัยใกล้หมดอายุ'] },
    { id: 3, plate_no: 'กข-3333 ลำปาง', driver_name: '-', student_count: 0,
      school_names: 'โรงเรียนตัวอย่าง ค', risk_reasons: ['ยังไม่มีคนขับ', 'ยังไม่ผ่านการตรวจ'] },
  ] },

  '/api/province/status-today':  { data: STATUS_TODAY },
  '/api/province/emergencies':   { data: EMERGENCIES },
  '/api/province/live-vehicles': { data: LIVE_VEHICLES },
  '/api/province/pickup-map':    { data: PICKUP_POINTS },
  '/api/province/audit-logs':    AUDIT_ROWS_GENERIC,
  '/api/province/vehicles-at-risk': { data: [
      // field ต้องตรงกับที่ VehicleAtRiskRow ใช้ — key={v.id} ถ้าไม่มี id
    // React จะเตือน duplicate key และ gate จะจับได้
    { id: 2, plate_no: 'กข-2222 ลำปาง', driver_name: 'คนขับ ตัวอย่าง ข', student_count: 4,
      school_names: 'โรงเรียนตัวอย่าง ก', risk_reasons: ['ประกันภัยใกล้หมดอายุ'] },
    { id: 3, plate_no: 'กข-3333 ลำปาง', driver_name: '-', student_count: 0,
      school_names: 'โรงเรียนตัวอย่าง ค', risk_reasons: ['ยังไม่มีคนขับ', 'ยังไม่ผ่านการตรวจ'] },
  ] },

  '/api/transport/dashboard':  { data: TRANSPORT_DASH },
  '/api/transport/pickup-map': { data: PICKUP_POINTS },

  '/api/admin/pending-requests-count': { data: { transfer: 2, vehicle: 1, roster: 1, registration: 1, total: 5 } },
  '/api/admin/system-health': { data: {
    db: { status: 'ok', latency_ms: 4 }, api: { status: 'ok', uptime_h: 8 },
    backup: { status: 'ok', last_run: '2026-08-27T02:30:00+07:00', size_mb: 2.5 },
    counters: { users: 1284, students: 4696, vehicles: 481, checkins_today: 1180 },
  } },
  '/api/readiness': { data: {
    overall: 'ready',
    checks: [
      { key: 'accounts', label: 'บัญชีผู้ใช้พร้อมใช้งาน', status: 'warn', detail: 'ยังไม่เข้าระบบครั้งแรก 467 บัญชี' },
      { key: 'vehicles', label: 'รถผ่านการตรวจ', status: 'ok', detail: '402 จาก 481 คัน' },
      { key: 'backup', label: 'สำรองข้อมูลอัตโนมัติ', status: 'ok', detail: 'ล่าสุด 27 ส.ค. 02:30 น.' },
    ],
  } },
  '/api/reports/monthly': { data: { month: '2026-08', rows: STATUS_TODAY.rows } },
  '/api/reports/summary': { data: { term: '1/2569', rows: STATUS_TODAY.rows, totals: { students: 4696, checkins: 128400 } } },
  // analytics ping — ไม่มีผลต่อภาพ แต่ถ้าไม่ตอบจะขึ้นในรายงาน fixture ที่ขาด
  '/api/visits/track': { data: { ok: true } },
  '/api/verification/transport/queue':     { data: VERIFY_QUEUE },
  '/api/verification/transport/checklist': { data: [CHECKLIST_TEMPLATE] },
  '/api/verification/transport/drivers':   { data: VERIFY_DRIVERS },
  '/api/admin/snapshots': { data: [
    { id: 9, snapshot_date: '2026-08-25', is_baseline: false, run_type: 'manual', baseline_note: null, ...SNAP_METRICS },
    { id: 1, snapshot_date: '2026-01-08', is_baseline: true,  run_type: 'manual', baseline_note: 'Research R2 Pre-measure Baseline', research_phase: 'pre-measure', ...SNAP_METRICS, students_with_vehicle: 940, vehicles_inspected: 121 },
  ] },
  '/api/admin/research-export/preview': { data: {
    snapshots: 9, baselines: 1, audit_logs: 1240, export_logs: 41,
    earliest_snapshot: '2026-01-08', latest_snapshot: '2026-08-25',
  } },
  '/api/admin/evaluation-summary': { data: EVAL_SUMMARY },
  '/api/admin/terms': { data: [
    { id: '2569-1', name: 'ภาคเรียนที่ 1/2569', start_date: '2026-05-16', end_date: '2026-10-10', is_current: true },
    { id: '2568-2', name: 'ภาคเรียนที่ 2/2568', start_date: '2025-11-01', end_date: '2026-03-31', is_current: false },
  ] },
  '/api/admin/driver-integrity': { data: {
    vehicles_no_active_driver: 3, active_drivers_no_vehicle: 1,
    inactive_duplicate_candidates: 2, active_unlinked_drivers: 0,
    active_assignment_to_soft_deleted_vehicle: 0, vehicles_multiple_active_drivers: 1,
    blocked_reactivations_30d: 4,
    vehicles_no_driver_list: [
      { id: 'V-7', plate_no: 'กข-7777 ลำปาง' },
      { id: 'V-8', plate_no: 'กข-8888 ลำปาง' },
    ],
  } },
  '/api/geofences': { data: [
    { id: 'G-1', name: 'โรงเรียนบ้านตัวอย่าง', target_type: 'SCHOOL', radius_meters: 200, trigger_on: 'BOTH', is_active: true, plate_no: null },
    { id: 'G-2', name: 'จุดรับ-ส่ง: ปากซอย A', target_type: 'PICKUP_POINT', radius_meters: 150, trigger_on: 'ENTER', is_active: false, plate_no: 'กข-1111 ลำปาง' },
  ] },
  '/api/geofences/events/list': { data: [
    { id: 1, occurred_at: '2026-08-26T01:12:00Z', geofence_name: 'โรงเรียนบ้านตัวอย่าง', vehicle_id: 'V-1', event_type: 'ENTER', notifications_sent: 12 },
    { id: 2, occurred_at: '2026-08-26T01:40:00Z', geofence_name: 'โรงเรียนบ้านตัวอย่าง', vehicle_id: 'V-1', event_type: 'EXIT',  notifications_sent: 12 },
  ] },
  '/api/route-deviations': { data: [
    { id: 1, deviation_type: 'OFF_ROUTE', vehicle_id: 'V-1', offset_meters: 320, occurred_at: '2026-08-26T01:05:00Z', resolved_at: null, severity: 'WARN' },
    { id: 2, deviation_type: 'LATE',      vehicle_id: 'V-2', delay_minutes: 18,  occurred_at: '2026-08-26T00:50:00Z', resolved_at: '2026-08-26T01:20:00Z', severity: 'CRITICAL' },
    { id: 3, deviation_type: 'STALLED',   vehicle_id: 'V-3', delay_minutes: 9,   occurred_at: '2026-08-25T23:30:00Z', resolved_at: null, severity: 'INFO' },
  ] },
  '/api/admin/pickup-points': { data: PICKUP_POINTS, meta: { total: 3, page: 1, limit: 20 } },
  '/api/province/vehicles': { data: PICKUP_VEHICLES },
  '/api/parent/children': { data: [
    { student_id: 'S-1', prefix: 'ด.ช.', first_name: 'นักเรียน', last_name: 'ทดสอบหนึ่ง',
      school_name: 'โรงเรียนบ้านตัวอย่าง', grade: 'ป.4', classroom: '1',
      plate_no: 'กข-1111 ลำปาง', driver_name: 'คนขับ ทดสอบหนึ่ง',
      morning_status: 'CHECKED_IN',  morning_time: '2026-08-26T00:42:00Z',
      evening_status: 'PENDING',     evening_time: null },
    { student_id: 'S-2', prefix: 'ด.ญ.', first_name: 'นักเรียน', last_name: 'ทดสอบสอง',
      school_name: 'โรงเรียนบ้านตัวอย่าง', grade: 'ป.4', classroom: '2',
      plate_no: 'กข-2222 ลำปาง', driver_name: 'คนขับ ทดสอบสอง',
      morning_status: 'CHECKED_OUT', morning_time: '2026-08-26T00:51:00Z',
      evening_status: 'ABSENT',      evening_time: null },
  ] },
  // Level 2 so the driver row and its tel: link render — at level 1 they are
  // absent, which is why that link went unmeasured in the first pass.
  '/api/qr/vehicle/QR-TEST-TOKEN': { data: {
    level: 2, plate_no: 'กข-1111 ลำปาง',
    inspection_status: 'ผ่าน', insurance_status: 'มีประกันภัย', driver_status: 'ปกติ',
    driver_name: 'คนขับ ทดสอบหนึ่ง', emergency_contact: '0800000000',
  } },
  '/api/reports/daily': { data: {
    date: '2026-08-26',
    morning_total: 186, morning_done: 174, evening_total: 186, evening_done: 168,
    schools: [
      { school_id: 'SC-1', school_name: 'โรงเรียนบ้านตัวอย่าง', morning_total: 96, morning_done: 92, evening_total: 96, evening_done: 90 },
      { school_id: 'SC-2', school_name: 'โรงเรียนตัวอย่างสอง',  morning_total: 90, morning_done: 82, evening_total: 90, evening_done: 78 },
    ],
    vehicles: [
      { vehicle_id: 'V-1', plate_no: 'กข-1111 ลำปาง', driver_name: 'คนขับ ทดสอบหนึ่ง', morning_total: 9, morning_done: 9, evening_total: 9, evening_done: 8 },
      { vehicle_id: 'V-2', plate_no: 'กข-2222 ลำปาง', driver_name: 'คนขับ ทดสอบสอง',  morning_total: 4, morning_done: 3, evening_total: 4, evening_done: 4 },
    ],
  } },
  '/api/school/students': { data: [
    { id: 'S-1', student_code: '52020001', prefix: 'ด.ช.', first_name: 'นักเรียน', last_name: 'ทดสอบหนึ่ง', grade: 'ป.4', classroom: '1', vehicle_id: 'V-1', plate_no: 'กข-1111 ลำปาง', guardian_name: 'ผู้ปกครอง ทดสอบ', guardian_phone: '0800000001' },
    { id: 'S-2', student_code: '52020002', prefix: 'ด.ญ.', first_name: 'นักเรียน', last_name: 'ทดสอบสอง', grade: 'ป.4', classroom: '2', vehicle_id: null, plate_no: null, guardian_name: null, guardian_phone: null },
  ], meta: { total: 2, page: 1, limit: 20 } },
  '/api/terms/current': { data: { term_id: '2569-1', name: 'ภาคเรียนที่ 1/2569', start_date: '2026-05-16', end_date: '2026-10-10' } },
  '/api/school/students/transfer-requests': { data: [
    { id: 'TR-1', student_id: 'S-1', destination_school_id: '52020082', destination_school_name: 'โรงเรียนตัวอย่างปลายทาง', status: 'PENDING', admin_note: null },
  ] },
  '/api/school/students/import/batches': { data: [
    { batch_id: 'B-2', created_at: '2026-08-25T03:00:00Z', filename: 'students-aug.csv', status: 'APPLIED',         rollback_status: null, total_rows: 42, insert_count: 40, error_count: 2, expires_at: '2026-09-25T03:00:00Z' },
    { batch_id: 'B-1', created_at: '2026-07-02T03:00:00Z', filename: 'students-jul.csv', status: 'APPLIED_PARTIAL', rollback_status: null, total_rows: 30, insert_count: 24, error_count: 6, expires_at: '2026-08-02T03:00:00Z' },
  ] },
  '/api/affiliation/school-accounts': { data: [
    { id: 'A-1', school_name: 'โรงเรียนบ้านตัวอย่าง', username: '520341', is_active: true },
    { id: 'A-2', school_name: 'โรงเรียนตัวอย่างสอง',  username: '520342', is_active: false },
  ] },
  '/api/affiliation/schools': { data: [
    { id: 'SC-1', name: 'โรงเรียนบ้านตัวอย่าง' },
    { id: 'SC-2', name: 'โรงเรียนตัวอย่างสอง' },
  ] },
  '/api/driver/registrations': { data: {
    vehicle_id: 'V-1', eligible: true,
    students: [{ id: 'RS-1', raw_student_name: 'เด็กชาย ทดสอบ ใจดี', school_id: 'SC-1', school_name: 'โรงเรียนบ้านตัวอย่าง', review_status: 'PENDING' }],
    schools: [{ id: 'SC-1', name: 'โรงเรียนบ้านตัวอย่าง', approval_status: 'APPROVED' }],
  } },
  '/api/driver/registrations/documents': { data: { vehicle_documents: [], driver_documents: [] } },
  '/api/transport/inspections': { data: [
    { id: 'I-1', plate_no: 'กข-1111 ลำปาง', result: 'PASSED',    inspection_date: '2026-08-01', expiry_date: '2027-08-01', inspector_name: 'เจ้าหน้าที่ ทดสอบ', notes: null },
    { id: 'I-2', plate_no: 'กข-2222 ลำปาง', result: 'NEEDS_FIX', inspection_date: '2026-07-15', expiry_date: null,         inspector_name: 'เจ้าหน้าที่ ทดสอบ', notes: 'ยางสึก' },
  ], meta: { page: 1, per_page: 20, total: 2 } },
  '/api/transport/vehicles': { data: PICKUP_VEHICLES, meta: { page: 1, per_page: 20, total: 2 } },
  '/api/transport/schools': { data: [
    { id: 'SC-1', name: 'โรงเรียนบ้านตัวอย่าง' },
    { id: 'SC-2', name: 'โรงเรียนตัวอย่างสอง' },
  ] },
  '/api/province/schools': { data: [
    { id: 'SC-1', name: 'โรงเรียนบ้านตัวอย่าง' },
    { id: 'SC-2', name: 'โรงเรียนตัวอย่างสอง' },
  ] },
  '/api/admin/live-vehicles': { data: {
    generated_at: '2026-08-26T01:45:00Z',
    vehicles: [
      { vehicle_id: 'V-1', plate_no: 'กข-1111 ลำปาง', driver_name: 'คนขับ ทดสอบหนึ่ง', student_count: 9, status: 'online',  latitude: 18.2888, longitude: 99.4908, accuracy: 8,  last_seen_at: '2026-08-26T01:44:40Z' },
      { vehicle_id: 'V-2', plate_no: 'กข-2222 ลำปาง', driver_name: 'คนขับ ทดสอบสอง', student_count: 4, status: 'stale',   latitude: 18.2802, longitude: 99.4855, accuracy: 45, last_seen_at: '2026-08-26T01:38:00Z' },
      { vehicle_id: 'V-3', plate_no: 'กข-3333 ลำปาง', driver_name: null,               student_count: 0, status: 'offline', latitude: null,    longitude: null,   accuracy: null, last_seen_at: null },
    ],
  } },
  '/api/driver/pickup-points':   { data: { vehicle: PICKUP_VEHICLES[0], points: PICKUP_POINTS.filter(p => p.vehicle_id === 'V-1') } },
  '/api/driver/pickup-students': { data: PICKUP_STUDENTS },
  '/api/school/pickup-points':   { data: PICKUP_POINTS },
  '/api/school/pickup-students': { data: PICKUP_STUDENTS },
  '/api/school/pickup-vehicles': { data: PICKUP_VEHICLES },
};

function mockFor(url, scenario) {
  const set = SCENARIOS[scenario] || SCENARIOS.normal;
  try {
    const u = new URL(url);
    if (u.pathname === '/api/admin/users' && u.searchParams.get('is_active') === 'false') {
      return set['/api/admin/users?is_active=false'] ?? null;
    }
    const exact = set[u.pathname] ?? COMMON[u.pathname];
    if (exact) return exact;
    // A few endpoints carry an id in the path.
    if (/^\/api\/school\/students\/import\/[^/]+$/.test(u.pathname)) return IMPORT_DETAIL;
    // Transport verification — the write flow. Start returns an attempt id so the
    // checklist panel can render; finalize/abort answer so the UI can settle.
    if (/^\/api\/verification\/applications\/\d+$/.test(u.pathname)) {
      const id = Number(u.pathname.split('/').pop());
      const row = VERIFY_QUEUE.find(r => r.id === id);
      if (!row) return null;
      const attempts = inspectionAttempt && inspectionAttempt.application_id === id
        ? [inspectionAttempt] : [];
      return { data: { ...row, drivers: [], attempts } };
    }
    if (/^\/api\/verification\/transport\/applications\/(\d+)\/start$/.test(u.pathname)) {
      const appId = Number(u.pathname.match(/applications\/(\d+)\/start/)[1]);
      inspectionAttempt = { id: 77001, application_id: appId, result: 'IN_PROGRESS',
                            inspected_by: 1, started_at: '2026-08-27T02:00:00Z' };
      return { data: { attempt_id: 77001, result: 'IN_PROGRESS' } };
    }
    if (/^\/api\/verification\/transport\/attempts\/\d+\/(finalize|abort)$/.test(u.pathname)) {
      return { data: { ok: true } };
    }
    if (/^\/api\/verification\/transport\/(vehicles|drivers)\/\d+\/(drivers|qualification)$/.test(u.pathname)) {
      return { data: { ok: true } };
    }
    return null;
  } catch { return null; }
}

async function newPage(browser, user, viewport, scenario) {
  resetInspectionState();
  // deviceScaleFactor เป็น option ของ context ไม่ใช่ของ viewport — ถ้าปล่อยปนอยู่
  // ใน viewport, Playwright จะเมินเงียบ ๆ แล้วได้ภาพความละเอียด 1x
  // (manual-screenshots.mjs ต้องการ 2x ให้ตรงกับภาพเดิมในคู่มือ)
  const { deviceScaleFactor, ...vp } = viewport;
  const ctx = await browser.newContext({
    viewport: vp, deviceScaleFactor, locale: 'th-TH', timezoneId: 'Asia/Bangkok',
  });
  const page = await ctx.newPage();
  const errors = [];
  const renderLoops = [];
  await page.addInitScript(`
    localStorage.setItem('access_token',  ${JSON.stringify(FAKE_TOKEN)});
    localStorage.setItem('refresh_token', ${JSON.stringify(FAKE_TOKEN)});
    localStorage.setItem('user',          ${JSON.stringify(JSON.stringify(user))});
  `);
  page.on('console',   m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

  // Render-loop guard. A component that writes state during render (rather
  // than from an effect or a handler) makes React throw
  // "Maximum update depth exceeded" / "Too many re-renders". Those surface as
  // console errors, which every capture already asserts to be zero — this
  // records them separately so a loop is named rather than buried in the count.
  page.on('console', m => {
    const t = m.text();
    if (/Maximum update depth exceeded|Too many re-renders|Cannot update a component .* while rendering/i.test(t)) {
      renderLoops.push(t.slice(0, 200));
    }
  });

  // Anchor at the origin root: a bare `**/api/**` also matches Vite's own
  // module URLs (e.g. /src/api/axios.js), which breaks the app boot.
  await page.route(/^https?:\/\/[^/]+\/api\//, async route => {
    if (SCENARIOS[scenario]?.__ALL_FAIL__) {
      return route.fulfill({ status: 500, contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'ระบบขัดข้องชั่วคราว' }) });
    }
    const m = mockFor(route.request().url(), scenario);
    // A fixture may pin a non-2xx status — the only way to exercise the paths
    // that branch on *why* a call failed rather than that it failed.
    if (m?.__status) {
      return route.fulfill({
        status: m.__status, contentType: 'application/json',
        body: JSON.stringify({ success: false, message: m.message || '', errors: [], data: null }),
      });
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(m ? { success: true, message: 'OK', ...m } : { success: true, message: 'OK', data: {} }),
    });
  });
  return { ctx, page, errors, renderLoops };
}

const MEASURE = `(() => {
  const de = document.documentElement;
  // The .tap-target utility extends the hit box to 44px with a centred
  // ::after, which getBoundingClientRect cannot see. Exclude those rather
  // than report a target that is actually compliant.
  //
  // A checkbox or radio wrapped in a <label> is tapped anywhere on that label,
  // so the label is the target 2.5.8 measures — a 20px box inside a 44px row
  // is compliant. Measure the clickable region, not the painted control.
  const hitBox = e => {
    const own = e.getBoundingClientRect();
    if (!/^(checkbox|radio)$/.test(e.type || '')) return own;
    const lab = e.closest('label')
      || (e.id && document.querySelector('label[for="' + CSS.escape(e.id) + '"]'));
    if (!lab) return own;
    const b = lab.getBoundingClientRect();
    return (b.width >= own.width && b.height >= own.height) ? b : own;
  };
  // Leaflet's own marker pins and attribution links are third-party map chrome
  // covered by the 2.5.8 "essential" exception — a pin's size is its position.
  // Its zoom buttons are NOT exempt and are restyled to 44px in index.css, so
  // they stay measured here.
  const exemptMapChrome = e =>
    e.closest('.leaflet-marker-icon, .leaflet-control-attribution') !== null
    || e.classList.contains('leaflet-marker-icon');
  const small = [...document.querySelectorAll('button,a,input,select,[role=button]')]
    .filter(e => !e.classList.contains('tap-target'))
    .filter(e => !exemptMapChrome(e))
    .map(e => { const b = hitBox(e);
      return { label: (e.getAttribute('aria-label') || e.textContent || e.placeholder || '').trim().slice(0, 32),
               w: Math.round(b.width), h: Math.round(b.height) }; })
    .filter(e => e.h > 0 && (e.h < 44 || e.w < 44));
  // Sub-16px input text only matters on mobile, where iOS zooms the viewport on
  // focus. 14px on a desktop form is a deliberate density choice, not a defect.
  // A hidden input (a file picker behind a styled label) has no layout box and
  // never receives a keyboard, so it cannot trigger the zoom this measures.
  // Only controls that raise a text keyboard can trigger the zoom. A checkbox,
  // radio or file picker has no text to zoom into, so its font-size is a
  // styling choice rather than a defect.
  const TYPING = /^(text|search|email|url|tel|number|password|date|datetime-local|month|week|time|)$/;
  const tinyInputs = innerWidth >= 768 ? [] : [...document.querySelectorAll('input,select,textarea')]
    .filter(e => e.tagName !== 'INPUT' || TYPING.test(e.type || ''))
    .filter(e => e.getBoundingClientRect().height > 0)
    .map(e => ({ type: e.type || e.tagName, size: parseFloat(getComputedStyle(e).fontSize) }))
    .filter(e => e.size && e.size < 16);
  const offscreen = [...document.querySelectorAll('*')]
    .filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > innerWidth + 1; })
    .slice(0, 5).map(e => e.tagName + '.' + String(e.className).slice(0, 40));
  const scrollers = [...document.querySelectorAll('*')].filter(e => {
    const s = getComputedStyle(e);
    return /auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 4;
  }).length;
  return {
    viewport: innerWidth + 'x' + innerHeight,
    overflowPx: Math.max(0, de.scrollWidth - innerWidth),
    offscreen, smallTapTargets: small, tinyInputs, verticalScrollers: scrollers,
    h1: [...document.querySelectorAll('h1')].map(h => h.textContent.trim().slice(0, 40)),
    // A horizontally scrollable table must be reachable and operable by
    // keyboard (WCAG 2.1.1) and needs a name. Recorded so a regression that
    // drops the role/tabIndex from DataTable shows up as a number, not a
    // silent loss.
    keyboardScrollRegions: [...document.querySelectorAll('[role=region][tabindex="0"]')].length,
    unnamedScrollRegions: [...document.querySelectorAll('[role=region][tabindex="0"]')]
      .filter(e => !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).length,
  };
})()`;

const PRINT_MEASURE = `(() => {
  // getComputedStyle on the element alone misses an ancestor that is
  // display:none — which is exactly how the md: breakpoint hides one of the
  // two renderings. getClientRects() sees the whole chain.
  const vis = el => el.getClientRects().length > 0;
  return {
    // the md: breakpoint is width-based, so record the width the rule sees
    width: innerWidth,
    tables: [...document.querySelectorAll('table')].filter(vis).length,
    mobileCardLists: [...document.querySelectorAll('ul')]
      .filter(el => String(el.className).includes('md:hidden')).filter(vis).length,
  };
})()`;

// path, roles that may view it, which viewports, scenario
const SHOTS = [
  { id: '01-login',        url: '/login',       user: null,          vps: ['mobile', 'desktop'] },
  { id: '02-admin-dash',   url: '/admin',       user: 'admin',       vps: ['mobile', 'tablet', 'desktop', 'wide'] },
  { id: '03-admin-zero',   url: '/admin',       user: 'admin',       vps: ['desktop'], scenario: 'zero' },
  { id: '04-admin-large',  url: '/admin',       user: 'admin',       vps: ['desktop'], scenario: 'large' },
  { id: '05-admin-error',  url: '/admin',       user: 'admin',       vps: ['desktop'], scenario: 'error' },
  { id: '06-admin-users',  url: '/admin/users', user: 'admin',       vps: ['mobile', 'desktop'], print: true },
  { id: '07-province',     url: '/province',    user: 'province',    vps: ['mobile', 'desktop'] },
  { id: '08-affiliation',  url: '/affiliation', user: 'affiliation', vps: ['mobile', 'desktop'] },
  { id: '09-school',       url: '/school',      user: 'school',      vps: ['mobile', 'desktop'] },
  { id: '10-transport',    url: '/transport',   user: 'transport',   vps: ['mobile', 'desktop'] },
  { id: '11-driver',       url: '/driver',      user: 'driver',      vps: ['mobile', 'tablet'] },
  // บัญชีคนขับที่ยังไม่ผูกรถ — ต้องได้คำอธิบายภาษาไทย ไม่ใช่โมดัลบังคับที่ปิดไม่ได้
  { id: '11b-driver-unlinked', url: '/driver',  user: 'driver',      vps: ['mobile'], scenario: 'driver_unlinked',
    expect: ['text=บัญชีนี้ยังไม่ได้ผูกกับรถ', 'text=แจ้งโรงเรียน', 'button:has-text("ตรวจสอบอีกครั้ง")'] },
  { id: '12-reports',      url: '/reports/daily', user: 'admin',     vps: ['desktop'], print: true },
  // AuditLogTable renders a card timeline by design, not a table, so it is
  // not part of the print check.
  { id: '13-audit',        url: '/admin/audit-logs', user: 'admin',  vps: ['desktop'] },
  // List pages migrated onto DataTable / FilterBar
  { id: '20-prov-schools',      url: '/province/schools',      user: 'province', vps: ['mobile', 'desktop'] },
  { id: '21-prov-vehicles',     url: '/province/vehicles',     user: 'province', vps: ['mobile', 'desktop'] },
  { id: '22-prov-affiliations', url: '/province/affiliations', user: 'province', vps: ['desktop'] },
  { id: '23-aff-vehicles',      url: '/affiliation/vehicles',  user: 'affiliation', vps: ['mobile', 'desktop'] },
  { id: '24-school-vehicles',   url: '/school/vehicles',       user: 'school',   vps: ['mobile', 'desktop'] },
  { id: '25-transport-vehicles', url: '/transport/vehicles',   user: 'transport', vps: ['mobile', 'desktop'] },
  { id: '26-transfer-requests', url: '/admin/transfer-requests', user: 'admin', vps: ['mobile', 'desktop'] },
  { id: '27-vehicle-requests',  url: '/admin/vehicle-requests',  user: 'admin', vps: ['mobile', 'desktop'] },
  { id: '28-aff-transfers',     url: '/affiliation/transfer-requests', user: 'affiliation', vps: ['mobile', 'desktop'] },
  { id: '29-aff-veh-requests',  url: '/affiliation/vehicle-requests',  user: 'affiliation', vps: ['mobile', 'desktop'] },
  { id: '30-prov-students',     url: '/province/students',    user: 'province',    vps: ['mobile', 'desktop'] },
  { id: '31-aff-students',      url: '/affiliation/students', user: 'affiliation', vps: ['mobile', 'desktop'] },
  { id: '32-school-students',   url: '/school/students',      user: 'school', vps: ['mobile', 'desktop'] },
  // ยืนยันแทนคนขับแบบยกชุด — การติ๊กกลับด้าน (ติ๊ก = ไม่ได้ขึ้นรถ) ต้องอ่านไม่ผิด
  // จึงยืนยันว่าคำอธิบายและตัวนับทั้งสองฝั่งปรากฏพร้อมกันบนหน้าจอ
  { id: '09b-school-override-bulk', url: '/school', user: 'school', vps: ['desktop'],
    act: async (page) => {
      const btn = page.locator('button:has-text("ยืนยันแทนคนขับ")').first();
      if (await btn.count()) { await btn.click(); await page.waitForTimeout(600); }
    },
    expect: ['[role=dialog], .fixed.inset-0', 'text=ติ๊กเฉพาะคนที่', 'text=ไม่ได้ขึ้นรถ',
             'text=จะยืนยันว่า', 'button:has-text("ยืนยัน")'] },
  // ตัวกรอง "ยังไม่ผูกรถ" ต้องปรากฏให้ทั้งสามบทบาทที่ดูรายชื่อนักเรียนได้
  { id: '32b-school-students-filter', url: '/school/students', user: 'school', vps: ['desktop'],
    expect: ['text=กรองตามการผูกรถ', 'text=ยังไม่ผูกรถ'] },
  { id: '31b-aff-students-filter',    url: '/affiliation/students', user: 'affiliation', vps: ['desktop'],
    expect: ['text=กรองตามการผูกรถ', 'text=ยังไม่ผูกรถ'] },
  { id: '30b-prov-students-filter',   url: '/province/students', user: 'province', vps: ['desktop'],
    expect: ['text=กรองตามการผูกรถ', 'text=ยังไม่ผูกรถ'] },
  { id: '33-teacher-accounts',  url: '/school/teacher-accounts', user: 'school', vps: ['mobile', 'desktop'] },
  { id: '34-reports-monthly',   url: '/reports/monthly',      user: 'admin',  vps: ['mobile', 'desktop'] },
  { id: '35-reports-summary',   url: '/reports/summary',      user: 'admin',  vps: ['desktop'] },
  { id: '36-driver-pretrip',    url: '/driver/pretrip',       user: 'driver', vps: ['mobile'] },
  // ต้องบอกตั้งแต่ต้นว่าบันทึกไม่ได้ ไม่ใช่ปล่อยให้ติ๊กครบ 6 ข้อแล้วค่อยล้มเหลว
  { id: '36b-driver-pretrip-unlinked', url: '/driver/pretrip', user: 'driver', vps: ['mobile'], scenario: 'driver_unlinked',
    expect: ['text=บัญชีนี้ยังไม่ได้ผูกกับรถ', 'button:has-text("กลับหน้าแรก")'] },
  // กวาดหน้าคนขับที่เหลือด้วยสถานการณ์เดียวกัน เพื่อดูว่ามีหน้าใดพังอีก
  { id: '37-driver-roster-req-unlinked', url: '/driver/requests', user: 'driver', vps: ['mobile'], scenario: 'driver_unlinked' },
  { id: '38-driver-emergency-unlinked', url: '/driver/emergency', user: 'driver', vps: ['mobile'], scenario: 'driver_unlinked' },
  { id: '39-driver-profile-unlinked', url: '/driver/profile', user: 'driver', vps: ['mobile'], scenario: 'driver_unlinked',
    expect: ['text=บัญชีนี้ยังไม่ได้ผูกกับรถ'] },
  { id: '64-driver-pickup-unlinked', url: '/driver/pickup-map', user: 'driver', vps: ['mobile'], scenario: 'driver_unlinked' },
  { id: '89-driver-vehicle-reg-unlinked', url: '/driver/vehicle-registration', user: 'driver', vps: ['mobile'], scenario: 'driver_unlinked' },
  { id: '37-driver-roster-req', url: '/driver/requests',      user: 'driver', vps: ['mobile'] },
  { id: '38-driver-emergency',  url: '/driver/emergency',     user: 'driver', vps: ['mobile'] },
  { id: '39-driver-profile',    url: '/driver/profile',       user: 'driver', vps: ['mobile'] },
  { id: '40-change-password',   url: '/change-password',      user: 'school', vps: ['mobile', 'desktop'] },
  { id: '41-prov-pickup-map',   url: '/province/pickup-map',  user: 'province',    vps: ['mobile', 'desktop'] },
  { id: '68-research-metrics', url: '/admin/research',        user: 'admin', vps: ['mobile', 'desktop'],
    expect: ['table', 'text=เปรียบเทียบ Baseline', 'text=ดีขึ้น'] },
  { id: '69-research-export',  url: '/admin/research-export', user: 'admin', vps: ['mobile', 'desktop'],
    expect: ['input[type=date]', 'input[type=checkbox]', 'button:has-text("JSON")'] },
  { id: '70-evaluation',       url: '/admin/evaluation',      user: 'admin', vps: ['mobile', 'desktop'],
    // the role panels only render once expanded, so open one
    act: async page => { await page.getByRole('button', { name: /คนขับ/ }).first().click(); },
    expect: ['[aria-expanded="true"]', 'text=หลักฐานที่มี', 'text=Baseline vs Current'] },
  { id: '71-executive-print',  url: '/admin/executive-print', user: 'admin', vps: ['desktop'],
    expect: ['table', 'text=สรุปสำหรับผู้บริหาร', 'button:has-text("พิมพ์")'] },
  // These three are components, not routes, so the harness reaches them the
  // way a user does — by clicking the control on StudentSearch that opens
  // them. A build passes with an undefined identifier inside a modal body;
  // only rendering it catches that.
  { id: '79-import-preview', url: '/school/students', user: 'school', vps: ['mobile', 'desktop'],
    act: async page => { await page.getByRole('button', { name: 'นำเข้าข้อมูล' }).first().click(); },
    expect: ['[role=dialog]', 'input[type=file]', 'text=ตรวจสอบไฟล์ก่อนนำเข้า', 'text=ภาคเรียนที่จะบันทึก'] },
  { id: '80-import-history', url: '/school/students', user: 'school', vps: ['mobile', 'desktop'],
    act: async page => { await page.getByRole('button', { name: 'ประวัติการนำเข้า' }).first().click(); },
    expect: ['[role=dialog]', 'text=ประวัติการนำเข้า', 'text=students-aug.csv'] },
  { id: '81-import-history-detail', url: '/school/students', user: 'school', vps: ['desktop'],
    act: async page => {
      await page.getByRole('button', { name: 'ประวัติการนำเข้า' }).first().click();
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: 'เปิดดู' }).first().click();
    },
    // the detail view is where the three per-row confirmations and the
    // rollback path live
    expect: ['[role=dialog]', 'text=ย้อนกลับ', 'text=อัปเดตผู้ปกครอง', 'text=กู้คืนนักเรียน',
             'button:has-text("ดาวน์โหลดรายงาน (CSV)")'] },
  { id: '82-student-transfer', url: '/school/students', user: 'school', vps: ['mobile', 'desktop'],
    act: async page => {
      await page.getByRole('button', { name: 'แก้ไข' }).first().click();
      await page.waitForTimeout(400);
      await page.getByRole('button', { name: 'ขอโอนย้ายนักเรียน' }).first().click();
    },
    expect: ['[role=dialog]', 'text=รหัสโรงเรียนปลายทาง', 'text=คำขอนี้ยังไม่ย้ายข้อมูล',
             'text=คำขอของนักเรียนคนนี้'] },
  // The parent/LIFF and public-QR experiences had no captures at all. Outside
  // LINE there is no LIFF SDK, so utils/liff falls back to the ?line_user_id
  // query param — which is how these are reached here.
  // ParentStatus cannot be captured with data outside LINE, and that is the
  // point: getLiffIdToken() has no query-param fallback, so identity can only
  // come from a verified LIFF id_token. What is asserted here is that refusal.
  // The populated view has to be reviewed by a human inside the LINE client.
  { id: '90-parent-status', url: '/parent?line_user_id=U-test-parent', user: null, vps: ['mobile', 'desktop'],
    expect: ['text=ยังไม่ได้ผูกบัญชี LINE'] },
  { id: '91-parent-link',   url: '/parent/link?line_user_id=U-test-parent', user: null, vps: ['mobile', 'desktop'],
    expect: ['text=ผูกบัญชีผู้ปกครอง', 'text=เบอร์โทรศัพท์', 'text=รหัสนักเรียน'] },
  { id: '92-public-qr',     url: '/qr/QR-TEST-TOKEN', user: null, vps: ['mobile', 'desktop'],
    expect: ['text=กข-1111 ลำปาง', 'text=0800000000', 'button:has-text("ความเป็นส่วนตัว")'] },
  // The privacy notice only exists once opened, so its dismiss button was
  // never measured. It is now.
  { id: '93-public-qr-notice', url: '/qr/QR-TEST-TOKEN', user: null, vps: ['mobile', 'desktop'],
    act: async page => { await page.getByRole('button', { name: 'ความเป็นส่วนตัว' }).first().click(); },
    expect: ['text=รับทราบ'] },
  // Regression checks that screenshots alone cannot prove: typing must not
  // reset focus when an inline close callback changes identity, and required
  // FormField controls must participate in native form validation.
  { id: '94-modal-focus', url: '/admin/users', user: 'admin', vps: ['desktop'],
    act: async page => {
      await page.getByRole('button', { name: 'สร้างผู้ใช้ใหม่' }).first().click();
      const password = page.getByLabel(/รหัสผ่าน/).first();
      await password.click();
      await password.pressSequentially('secret12');
      const keptFocus = await password.evaluate(el => document.activeElement === el && el.value === 'secret12');
      if (!keptFocus) throw new Error('modal input lost focus while typing');
    },
    expect: ['[role=dialog]', 'input[type=password]'] },
  { id: '95-required-fields', url: '/change-password', user: 'school', vps: ['desktop'],
    act: async page => {
      const result = await page.locator('form').evaluate(form => ({
        required: [...form.querySelectorAll('input[type=password]')].every(input => input.required),
        valid: form.checkValidity(),
      }));
      if (!result.required || result.valid) throw new Error('required FormField controls do not block an empty form');
    },
    expect: ['input[type=password][required]'] },
  { id: '86-aff-accounts', url: '/affiliation/accounts', user: 'affiliation', vps: ['mobile', 'desktop'],
    act: async page => { await page.getByRole('button', { name: 'เปิดฟอร์ม' }).first().click(); },
    expect: ['text=รหัสโรงเรียน', 'text=ชื่อผู้ใช้', 'text=บัญชีที่สร้างล่าสุด', 'text=520341'] },
  { id: '87-aff-accounts-reset', url: '/affiliation/accounts', user: 'affiliation', vps: ['desktop'],
    act: async page => { await page.getByRole('button', { name: 'รีเซ็ตรหัส' }).first().click(); },
    expect: ['[role=dialog]', 'text=รหัสผ่านใหม่', 'text=ยืนยันรหัสผ่านใหม่'] },
  { id: '88-school-bulk-vehicles', url: '/school/bulk-vehicles', user: 'school', vps: ['mobile', 'desktop'],
    expect: ['text=ค้นหารถที่มีอยู่แล้วในระบบ', 'text=ทะเบียนรถ', 'text=หมวดอักษร', 'text=ประเภทรถ'] },
  { id: '89-driver-vehicle-reg', url: '/driver/vehicle-registration', user: 'driver', vps: ['mobile', 'desktop'],
    act: async page => { await page.getByRole('button', { name: /เพิ่มชื่อเด็ก/ }).first().click(); },
    expect: ['[role=radiogroup]', 'text=1. ชื่อเด็ก', 'text=2. โรงเรียน', 'text=3. ขึ้นรถรอบไหน'] },
  { id: '83-inspection-form', url: '/transport/inspections', user: 'transport', vps: ['mobile', 'desktop'],
    act: async page => { await page.getByRole('button', { name: 'บันทึกผลตรวจเดิม' }).first().click(); },
    expect: ['text=เลือกรถ', 'text=ผลตรวจ', 'text=วันที่ตรวจ', 'text=หน้านี้เป็นบันทึกแบบเดิม'] },
  // ── ขั้นตอนที่เขียนข้อมูลจริงของขนส่ง — ทดสอบด้วย fixture ไม่แตะ production ──
  // 1) เลือกคำขอจากคิว  2) กด "เริ่มตรวจรถคันนี้"  3) ต้องได้รายการตรวจให้ลง
  { id: '84b-transport-start-inspection', url: '/transport/verification', user: 'transport', vps: ['desktop'],
    act: async page => {
      await page.getByText('กข-1111 ลำปาง').first().click();
      await page.getByRole('button', { name: /เริ่มตรวจรถคันนี้/ }).click();
      await page.waitForTimeout(700);
    },
    expect: ['text=ระบบเบรก', 'text=เข็มขัดนิรภัยครบทุกที่นั่ง', 'text=ประตูและทางออกฉุกเฉิน'] },
  // ทางถอยต้องมีจริง — เจ้าหน้าที่ที่กดเริ่มตรวจผิดคันต้องยกเลิกได้ และต้องมี
  // การยืนยันก่อน ไม่ใช่ลบทิ้งทันทีจากการกดพลาด
  { id: '84c-transport-abort-confirms', url: '/transport/verification', user: 'transport', vps: ['desktop'],
    act: async page => {
      await page.getByText('กข-1111 ลำปาง').first().click();
      await page.getByRole('button', { name: /เริ่มตรวจรถคันนี้/ }).click();
      await page.waitForTimeout(700);
      await page.getByRole('button', { name: /ยกเลิกการตรวจ/ }).click();
      await page.waitForTimeout(400);
    },
    expect: ['[role=alertdialog]', 'text=ยกเลิกการตรวจ'] },
  // ลงผล "ผ่านทั้งหมด" ต้องทำให้ครบทุกหัวข้อ ไม่ใช่บางส่วน
  { id: '84d-transport-pass-all', url: '/transport/verification', user: 'transport', vps: ['desktop'],
    act: async page => {
      await page.getByText('กข-1111 ลำปาง').first().click();
      await page.getByRole('button', { name: /เริ่มตรวจรถคันนี้/ }).click();
      await page.waitForTimeout(700);
      await page.getByRole('button', { name: /ผ่านทั้งหมด/ }).click();
      await page.waitForTimeout(400);
    },
    expect: ['text=ตรวจแล้ว 5/5 หัวข้อ'] },
  { id: '84-verification-queue', url: '/transport/verification', user: 'transport', vps: ['mobile', 'desktop'],
    expect: ['text=ค้นหาในคิวตรวจ'] },
  { id: '85-transport-dash', url: '/transport', user: 'transport', vps: ['mobile', 'desktop'],
    expect: ['[role=radiogroup]', 'text=ค้นหาทะเบียนรถ'] },
  { id: '72-term-settings',    url: '/admin/term-settings',   user: 'admin', vps: ['mobile', 'desktop'],
    // the add-term form only exists once opened
    act: async page => { await page.getByRole('button', { name: /เพิ่มภาคเรียน/ }).first().click(); },
    expect: ['input[type=date]', 'text=รหัสภาคเรียน', 'button:has-text("บันทึก")'] },
  { id: '73-vehicle-qr',       url: '/admin/vehicle-qr',      user: 'admin', vps: ['mobile', 'desktop'],
    expect: ['text=รหัสรถ', 'button:has-text("สร้าง/หมุน QR")'] },
  { id: '74-driver-integrity', url: '/admin/driver-integrity', user: 'admin', vps: ['mobile', 'desktop'],
    act: async page => { await page.getByRole('button', { name: /เครื่องมือจัดการคนขับ/ }).first().click(); },
    expect: ['[role=dialog]', 'select', 'text=รหัสผู้ใช้คนขับ', 'button:has-text("ตรวจสอบก่อนดำเนินการ")'] },
  { id: '75-geofences',        url: '/admin/geofences',       user: 'admin', vps: ['mobile', 'desktop'],
    act: async page => { await page.getByRole('button', { name: /เพิ่มจุด/ }).first().click(); },
    expect: ['text=ชื่อจุดเตือนภัย', 'text=ละติจูด', 'text=เหตุการณ์ล่าสุด'] },
  { id: '76-route-deviations', url: '/admin/route-deviations', user: 'admin', vps: ['mobile', 'desktop'],
    expect: ['[role=radiogroup]', 'text=เบี่ยงเส้นทาง'] },
  { id: '77-admin-pickup-mgmt', url: '/admin/pickup-points',  user: 'admin', vps: ['mobile', 'desktop'],
    act: async page => { await page.getByRole('button', { name: /เพิ่มกรณีพิเศษ/ }).first().click(); },
    expect: ['[role=dialog]', 'text=ทะเบียนรถ', 'text=ป้ายชื่อจุด', '[role=radiogroup]'] },
  { id: '78-admin-live-veh',   url: '/admin/live-vehicles',   user: 'admin', vps: ['mobile', 'desktop'],
    expect: ['[role=radiogroup]', 'text=ตรวจสอบตำแหน่งรถ'] },
  { id: '64-driver-pickup',     url: '/driver/pickup-map',   user: 'driver',      vps: ['mobile', 'desktop'] },
  { id: '65-school-pickup',     url: '/school/pickup-map',   user: 'school',      vps: ['mobile', 'desktop'] },
  // The editor is a modal: capture it OPEN, so its body is actually rendered.
  { id: '66-driver-pickup-edit', url: '/driver/pickup-map',  user: 'driver',      vps: ['mobile', 'desktop'],
    act: async page => { await page.getByRole('button', { name: /เพิ่ม/ }).first().click(); },
    expect: ['[role=dialog]', 'input[type=checkbox]', '[role=radiogroup]',
             'text=ป้ายชื่อจุด', 'text=หมายเหตุ', 'button:has-text("บันทึก")'] },
  { id: '67-school-pickup-edit', url: '/school/pickup-map',  user: 'school',      vps: ['mobile', 'desktop'],
    act: async page => { await page.getByRole('button', { name: /เพิ่มจุดรับส่ง/ }).first().click(); },
    // the school editor additionally picks the vehicle that scopes the pupils
    expect: ['[role=dialog]', 'select', '[role=radiogroup]',
             'text=ป้ายชื่อจุด', 'text=หมายเหตุ', 'button:has-text("บันทึก")'] },
  { id: '42-transport-pickup',  url: '/transport/pickup-map', user: 'transport',   vps: ['desktop'] },
  { id: '43-aff-pickup-map',    url: '/affiliation/pickup-map', user: 'affiliation', vps: ['desktop'] },
];

// รันเป็นสคริปต์เท่านั้น — ไฟล์นี้ถูก import โดย manual-screenshots.mjs เพื่อใช้
// fixtures ชุดเดียวกัน ถ้าไม่มีการ์ดนี้ การ import จะถ่ายภาพทั้ง 132 หน้าทันที
const IS_MAIN = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export { USERS, VIEWPORTS, newPage, BASE };

if (IS_MAIN) await (async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const report = [];

  for (const shot of SHOTS) {
    // --only accepts a comma-separated list, so one run can cover a batch
    if (ONLY && !ONLY.split(',').some(f => shot.id.includes(f.trim()))) continue;
    for (const vname of shot.vps) {
      const name = `${shot.id}-${vname}`;
      const user = shot.user ? USERS[shot.user] : { role: 'none' };
      const { ctx, page, errors, renderLoops } = await newPage(browser, user, VIEWPORTS[vname], shot.scenario || 'normal');
      let metrics = null, failed = null;
      try {
        await page.goto(BASE + shot.url, { waitUntil: 'networkidle', timeout: 25000 });
        await page.waitForTimeout(600);
        // A modal only exists once something opens it, so a page-load capture
        // cannot prove its body renders. `act` opens it first — this is how the
        // ChangePassword "FormField is not defined" class of bug (which the
        // build did not catch) gets caught.
        if (shot.act) {
          await shot.act(page);
          await page.waitForTimeout(500);
        }
        // A screenshot proves nothing on its own — a modal that failed to open
        // just looks like the page behind it. These selectors must be present,
        // so a missing runtime identifier fails the capture instead of quietly
        // producing a pretty picture of the wrong thing.
        for (const sel of shot.expect || []) {
          if (await page.locator(sel).count() === 0) {
            throw new Error(`expected on page but missing: ${sel}`);
          }
        }
        await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
        metrics = await page.evaluate(MEASURE);
        // Reports are printed. DataTable renders a desktop <table> and a
        // mobile card list from one definition; the printed page must get the
        // table, not the cards. Assert that rather than assume the print
        // viewport lands above the md breakpoint.
        // A visible focus indicator is a WCAG 2.4.7 requirement, and it can be
        // lost silently: `.focus-ring:focus { outline: none }` and
        // `.focus-ring:focus-visible { outline: … }` have equal specificity, so
        // source order decides which wins. Tabbing once and reading the
        // computed outline turns that into a number instead of an assumption.
        metrics.focusRing = await (async () => {
          await page.keyboard.press('Tab');
          return page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return { reached: false };
            const cs = getComputedStyle(el);
            const visible = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
            return {
              reached: true,
              focusVisible: el.matches(':focus-visible'),
              hasFocusRingClass: el.classList.contains('focus-ring') || el.classList.contains('focus-ring-inverse'),
              outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
              visible,
            };
          });
        })();

        if (shot.print) {
          metrics.screenTables = await page.evaluate(PRINT_MEASURE);
          await page.emulateMedia({ media: 'print' });
          metrics.print = await page.evaluate(PRINT_MEASURE);
          await page.emulateMedia({ media: 'screen' });
        }
      } catch (e) { failed = e.message.split('\n')[0]; }
      await ctx.close();

      const rec = { name, url: shot.url, role: shot.user || 'public',
                    scenario: shot.scenario || 'normal', metrics, errors, renderLoops, failed };
      report.push(rec);
      const flag = failed ? '✗' : (metrics?.overflowPx > 0 ? '⚠ overflow' : '✓');
      console.log(`${flag} ${name}${failed ? '  ' + failed : ''}` +
        (metrics ? `  overflow=${metrics.overflowPx}px tap<44=${metrics.smallTapTargets.length} err=${errors.length}` : ''));
    }
  }

  await browser.close();

  // A --only run must not clobber the rest of the report, or the before/after
  // comparison silently narrows to whatever was captured last.
  let merged = report;
  if (ONLY) {
    try {
      const prev = JSON.parse(readFileSync(`${OUT}/report.json`, 'utf8'));
      const fresh = new Set(report.map(r => r.name));
      merged = [...prev.filter(r => !fresh.has(r.name)), ...report]
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch { /* no previous report — write just this run */ }
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(merged, null, 2));

  const overflow = report.filter(r => r.metrics?.overflowPx > 0);
  const withErr  = report.filter(r => r.errors.length);
  // Scenarios that fail calls on purpose log browser-level "Failed to load
  // resource" lines that are the fixture working, not the page misbehaving.
  const FAILS_BY_DESIGN = new Set(['error', 'driver_unlinked']);
  const unexpectedErr = report.filter(r => r.errors.length && !FAILS_BY_DESIGN.has(r.scenario));
  const failed   = report.filter(r => r.failed);
  const looping  = report.filter(r => r.renderLoops?.length);
  const smallTargets = report.filter(r => r.metrics?.smallTapTargets?.length);
  const tinyInputs = report.filter(r => r.metrics?.tinyInputs?.length);
  const unnamedRegions = report.filter(r => r.metrics?.unnamedScrollRegions > 0);
  const invisibleFocus = report.filter(r => (
    r.metrics?.focusRing?.hasFocusRingClass && !r.metrics.focusRing.visible
  ));
  console.log(`\n── ${TAG} summary ──`);
  console.log(`  captures: ${report.length}`);
  console.log(`  horizontal overflow: ${overflow.length}${overflow.length ? ' → ' + overflow.map(r => r.name).join(', ') : ''}`);
  console.log(`  console errors:      ${withErr.length} total · ${unexpectedErr.length} unexpected${unexpectedErr.length ? ' → ' + unexpectedErr.map(r => r.name).join(', ') : ''}`);
  console.log(`  failed captures:     ${failed.length}${failed.length ? ' → ' + failed.map(r => r.name).join(', ') : ''}`);
  console.log(`  render loops:        ${looping.length}${looping.length ? ' → ' + looping.map(r => r.name).join(', ') : ''}`);
  console.log(`  tap targets <44px:   ${smallTargets.length}${smallTargets.length ? ' → ' + smallTargets.map(r => r.name).join(', ') : ''}`);
  console.log(`  mobile inputs <16px: ${tinyInputs.length}${tinyInputs.length ? ' → ' + tinyInputs.map(r => r.name).join(', ') : ''}`);
  console.log(`  unnamed regions:     ${unnamedRegions.length}${unnamedRegions.length ? ' → ' + unnamedRegions.map(r => r.name).join(', ') : ''}`);
  console.log(`  invisible focus:     ${invisibleFocus.length}${invisibleFocus.length ? ' → ' + invisibleFocus.map(r => r.name).join(', ') : ''}`);
  console.log(`  → ${OUT}`);

  // The report is written before this point so failed runs still leave useful
  // evidence. Gate only this fresh run (not stale rows merged by --only).
  const gateFailures = [
    failed,
    overflow,
    unexpectedErr,
    looping,
    smallTargets,
    tinyInputs,
    unnamedRegions,
    invisibleFocus,
  ];
  if (gateFailures.some(rows => rows.length > 0)) process.exitCode = 1;
})();
