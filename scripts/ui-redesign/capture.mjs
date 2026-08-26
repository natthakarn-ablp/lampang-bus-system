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

function mockFor(url, scenario) {
  const set = SCENARIOS[scenario] || SCENARIOS.normal;
  try {
    const u = new URL(url);
    if (u.pathname === '/api/admin/users' && u.searchParams.get('is_active') === 'false') {
      return set['/api/admin/users?is_active=false'] ?? null;
    }
    return set[u.pathname] ?? null;
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
  const small = [...document.querySelectorAll('button,a,input,select,[role=button]')]
    .filter(e => !e.classList.contains('tap-target'))
    .map(e => { const b = e.getBoundingClientRect();
      return { label: (e.getAttribute('aria-label') || e.textContent || e.placeholder || '').trim().slice(0, 32),
               w: Math.round(b.width), h: Math.round(b.height) }; })
    .filter(e => e.h > 0 && (e.h < 44 || e.w < 44));
  // Sub-16px input text only matters on mobile, where iOS zooms the viewport on
  // focus. 14px on a desktop form is a deliberate density choice, not a defect.
  const tinyInputs = innerWidth >= 768 ? [] : [...document.querySelectorAll('input,select,textarea')]
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
];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const report = [];

  for (const shot of SHOTS) {
    if (ONLY && !shot.id.includes(ONLY)) continue;
    for (const vname of shot.vps) {
      const name = `${shot.id}-${vname}`;
      const user = shot.user ? USERS[shot.user] : { role: 'none' };
      const { ctx, page, errors, renderLoops } = await newPage(browser, user, VIEWPORTS[vname], shot.scenario || 'normal');
      let metrics = null, failed = null;
      try {
        await page.goto(BASE + shot.url, { waitUntil: 'networkidle', timeout: 25000 });
        await page.waitForTimeout(600);
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
