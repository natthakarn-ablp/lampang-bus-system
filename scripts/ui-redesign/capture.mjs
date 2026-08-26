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
};

// Endpoints shared by every scenario. The pickup editors are the same form on
// two roles; both need points, pupils and (for the school) vehicles before the
// editor can be opened at all.
const COMMON = {
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
    return set[u.pathname] ?? COMMON[u.pathname] ?? null;
  } catch { return null; }
}

async function newPage(browser, user, viewport, scenario) {
  const ctx = await browser.newContext({ viewport, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
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
  const tinyInputs = innerWidth >= 768 ? [] : [...document.querySelectorAll('input,select,textarea')]
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
  };
})()`;

// path, roles that may view it, which viewports, scenario
const SHOTS = [
  { id: '01-login',        url: '/login',       user: null,          vps: ['mobile', 'desktop'] },
  { id: '02-admin-dash',   url: '/admin',       user: 'admin',       vps: ['mobile', 'tablet', 'desktop', 'wide'] },
  { id: '03-admin-zero',   url: '/admin',       user: 'admin',       vps: ['desktop'], scenario: 'zero' },
  { id: '04-admin-large',  url: '/admin',       user: 'admin',       vps: ['desktop'], scenario: 'large' },
  { id: '05-admin-error',  url: '/admin',       user: 'admin',       vps: ['desktop'], scenario: 'error' },
  { id: '06-admin-users',  url: '/admin/users', user: 'admin',       vps: ['mobile', 'desktop'] },
  { id: '07-province',     url: '/province',    user: 'province',    vps: ['mobile', 'desktop'] },
  { id: '08-affiliation',  url: '/affiliation', user: 'affiliation', vps: ['mobile', 'desktop'] },
  { id: '09-school',       url: '/school',      user: 'school',      vps: ['mobile', 'desktop'] },
  { id: '10-transport',    url: '/transport',   user: 'transport',   vps: ['mobile', 'desktop'] },
  { id: '11-driver',       url: '/driver',      user: 'driver',      vps: ['mobile', 'tablet'] },
  { id: '12-reports',      url: '/reports/daily', user: 'admin',     vps: ['desktop'] },
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
  { id: '33-teacher-accounts',  url: '/school/teacher-accounts', user: 'school', vps: ['mobile', 'desktop'] },
  { id: '34-reports-monthly',   url: '/reports/monthly',      user: 'admin',  vps: ['mobile', 'desktop'] },
  { id: '35-reports-summary',   url: '/reports/summary',      user: 'admin',  vps: ['desktop'] },
  { id: '36-driver-pretrip',    url: '/driver/pretrip',       user: 'driver', vps: ['mobile'] },
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

(async () => {
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
  const failed   = report.filter(r => r.failed);
  const looping  = report.filter(r => r.renderLoops?.length);
  console.log(`\n── ${TAG} summary ──`);
  console.log(`  captures: ${report.length}`);
  console.log(`  horizontal overflow: ${overflow.length}${overflow.length ? ' → ' + overflow.map(r => r.name).join(', ') : ''}`);
  console.log(`  console errors:      ${withErr.length}${withErr.length ? ' → ' + withErr.map(r => r.name).join(', ') : ''}`);
  console.log(`  failed captures:     ${failed.length}${failed.length ? ' → ' + failed.map(r => r.name).join(', ') : ''}`);
  console.log(`  render loops:        ${looping.length}${looping.length ? ' → ' + looping.map(r => r.name).join(', ') : ''}`);
  console.log(`  → ${OUT}`);
})();
