/**
 * Browser review script for the Lampang Bus System frontend.
 *
 * Captures screenshots of the redesigned pages at multiple viewports with a
 * mock auth context (so we don't need a live backend / real login).
 *
 * Prereqs (one-time, needs sudo):
 *   sudo apt-get install -y libatk-bridge2.0-0 libatk1.0-0 libcups2 \
 *       libxkbcommon0 libxrandr2 libgbm1 libxss1 libasound2t64 libnss3
 *   cd frontend && npm install --no-save playwright
 *   npx playwright install chromium
 *
 * Run:
 *   cd frontend && npx vite --port 5173 &        # one terminal
 *   node scripts/browser-review.mjs              # another terminal
 *   open /tmp/lampang-shots/                     # screenshots land here
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const BASE  = process.env.BASE_URL || 'http://localhost:5173';
const SHOTS = process.env.SHOTS_DIR || '/tmp/lampang-shots';
mkdirSync(SHOTS, { recursive: true });

const USERS = {
  driver:   { username: 'driver01',   display_name: 'คนขับ ทดสอบ',  role: 'driver',   driver_id: 1 },
  school:   { username: 'school01',   display_name: 'อนุบาลลำปาง',   role: 'school',   scope_type: 'SCHOOL',   scope_id: 'SCH0001' },
  province: { username: 'province01', display_name: 'จังหวัดลำปาง', role: 'province', scope_type: 'PROVINCE', scope_id: 'LPG' },
  admin:    { username: 'admin',      display_name: 'ผู้ดูแลระบบ',   role: 'admin' },
};
const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.fake.signature';

function injectScript(user) {
  return `
    localStorage.setItem('access_token',  ${JSON.stringify(FAKE_TOKEN)});
    localStorage.setItem('refresh_token', ${JSON.stringify(FAKE_TOKEN)});
    localStorage.setItem('user',          ${JSON.stringify(JSON.stringify(user))});
  `;
}

const VIEWPORTS = {
  mobile:  { width: 375,  height: 812 },
  tablet:  { width: 768,  height: 1024 },
  desktop: { width: 1280, height: 800 },
};

async function shoot(page, name) {
  await page.waitForTimeout(400);
  // viewport-only (not fullPage) — full-page captures crash chromium-headless
  // on small VMs because the entire scrollable area must be rasterized into
  // one buffer. Viewport screenshots stream tile-by-tile and stay bounded.
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  console.log(`  ✓ ${name}.png`);
  // Settle between captures to let chromium reclaim memory before next page.
  await page.waitForTimeout(800);
}

// Route-specific mock payloads. Routes not matched fall through to the
// empty-data response, which is fine for shell-only captures.
const MOCK = {
  '/api/reports/monthly': {
    data: {
      morning_kpi: 96.4, evening_kpi: 97.1,
      total_morning_done: 4820, total_morning_expected: 5000,
      total_evening_done:  4855, total_evening_expected: 5000,
      days_with_data: 22, days_morning_100: 14, days_evening_100: 16,
      emergency_count: 1, total_students: 268,
      schools: [
        { school_id: 'SCH001', school_name: 'อนุบาลลำปางเขลางค์รัตน์อนุสรณ์', morning_kpi: 99.1, evening_kpi: 99.5, emergency_count: 0 },
        { school_id: 'SCH002', school_name: 'โรงเรียนเทศบาล 1',                morning_kpi: 95.8, evening_kpi: 96.4, emergency_count: 0 },
        { school_id: 'SCH003', school_name: 'โรงเรียนทดสอบชื่อยาวมากๆ',          morning_kpi: 87.2, evening_kpi: 90.3, emergency_count: 1 },
        { school_id: 'SCH004', school_name: 'โรงเรียน A',                       morning_kpi: 75.5, evening_kpi: 78.0, emergency_count: 0 },
        { school_id: 'SCH005', school_name: 'โรงเรียน B',                       morning_kpi: 60.2, evening_kpi: 65.0, emergency_count: 2 },
      ],
      vehicles: [
        { vehicle_id: 'V-001', plate_no: 'นข 1111 ลำปาง', school_names: 'อนุบาลลำปาง, เทศบาล 1',     morning_kpi: 99.0, evening_kpi: 99.5, emergency_count: 0 },
        { vehicle_id: 'V-002', plate_no: 'นข 2210 ลำปาง', school_names: 'อนุบาลลำปาง',                 morning_kpi: 94.2, evening_kpi: 95.0, emergency_count: 0 },
        { vehicle_id: 'V-003', plate_no: 'นข 3333 ลำปาง', school_names: 'โรงเรียน A, B, C',           morning_kpi: 80.5, evening_kpi: 82.0, emergency_count: 1 },
        { vehicle_id: 'V-004', plate_no: 'นข 4444 ลำปาง', school_names: 'โรงเรียน B',                  morning_kpi: 70.1, evening_kpi: 72.0, emergency_count: 0 },
        { vehicle_id: 'V-005', plate_no: 'นข 5555 ลำปาง', school_names: 'โรงเรียนทดสอบชื่อยาวมากๆ',     morning_kpi: 55.0, evening_kpi: 58.5, emergency_count: 2 },
      ],
      daily_trend: [],
    },
  },
  '/api/reports/summary': {
    data: {
      total_students: 268, total_vehicles: 50, total_schools: 2, total_affiliations: 5,
      morning_kpi: 96.4, evening_kpi: 97.1,
      total_morning_done: 4820, total_morning_expected: 5000,
      total_evening_done:  4855, total_evening_expected: 5000,
      affiliations: [
        { id: 'AFF001', name: 'สพป.ลำปาง เขต 1', school_count: 5, student_count: 120, vehicle_count: 22, morning_kpi: 98.5, evening_kpi: 99.0, emergency_count: 0 },
        { id: 'AFF002', name: 'สพป.ลำปาง เขต 2', school_count: 4, student_count:  90, vehicle_count: 16, morning_kpi: 92.3, evening_kpi: 93.0, emergency_count: 1 },
        { id: 'AFF003', name: 'สพป.ลำปาง เขต 3', school_count: 3, student_count:  58, vehicle_count: 12, morning_kpi: 80.0, evening_kpi: 82.5, emergency_count: 0 },
      ],
      schools: [
        { school_id: 'SCH001', school_name: 'อนุบาลลำปางเขลางค์รัตน์อนุสรณ์', morning_kpi: 99.1, evening_kpi: 99.5, emergency_count: 0 },
        { school_id: 'SCH002', school_name: 'โรงเรียนเทศบาล 1',                morning_kpi: 95.8, evening_kpi: 96.4, emergency_count: 0 },
        { school_id: 'SCH003', school_name: 'โรงเรียนทดสอบชื่อยาว',             morning_kpi: 87.2, evening_kpi: 90.3, emergency_count: 1 },
        { school_id: 'SCH004', school_name: 'โรงเรียน A',                       morning_kpi: 75.5, evening_kpi: 78.0, emergency_count: 0 },
        { school_id: 'SCH005', school_name: 'โรงเรียน B',                       morning_kpi: 60.2, evening_kpi: 65.0, emergency_count: 2 },
      ],
      vehicles: [
        { vehicle_id: 'V-001', plate_no: 'นข 1111 ลำปาง', school_names: 'อนุบาลลำปาง', morning_kpi: 99.0, evening_kpi: 99.5, emergency_count: 0 },
        { vehicle_id: 'V-002', plate_no: 'นข 2210 ลำปาง', school_names: 'อนุบาลลำปาง', morning_kpi: 94.2, evening_kpi: 95.0, emergency_count: 0 },
        { vehicle_id: 'V-003', plate_no: 'นข 3333 ลำปาง', school_names: 'โรงเรียน A',  morning_kpi: 80.5, evening_kpi: 82.0, emergency_count: 1 },
        { vehicle_id: 'V-004', plate_no: 'นข 4444 ลำปาง', school_names: 'โรงเรียน B',  morning_kpi: 70.1, evening_kpi: 72.0, emergency_count: 0 },
        { vehicle_id: 'V-005', plate_no: 'นข 5555 ลำปาง', school_names: 'โรงเรียนทดสอบ', morning_kpi: 55.0, evening_kpi: 58.5, emergency_count: 2 },
      ],
    },
  },
  '/api/admin/audit-logs': {
    data: [
      { id: 1, created_at: '2026-05-09T08:30:00Z', actor_name: 'admin@lampang.go.th', action: 'CREATE',  entity_type: 'student',         entity_id: 'STU-001', new_value: { first_name: 'สมชาย', last_name: 'ใจดี' } },
      { id: 2, created_at: '2026-05-09T09:15:00Z', actor_name: 'admin@lampang.go.th', action: 'UPDATE',  entity_type: 'vehicle',         entity_id: 'V-002',   old_value: { plate_no: 'นข 2210 ลำปาง', vehicle_id: 'V-002' }, new_value: { plate_no: 'นข 2211 ลำปาง' } },
      { id: 3, created_at: '2026-05-09T10:42:00Z', actor_name: 'school01',            action: 'IMPORT',  entity_type: 'student',         entity_id: null,      new_value: { success: 28, errors: 2 } },
      { id: 4, created_at: '2026-05-09T11:05:00Z', actor_name: 'school01',            action: 'APPROVE', entity_type: 'roster_request', entity_id: 'REQ-014', new_value: { status: 'approved', requestType: 'add' } },
      { id: 5, created_at: '2026-05-09T11:50:00Z', actor_name: 'driver-tester',       action: 'LOGIN',   entity_type: 'user',           entity_id: null,      new_value: {} },
      { id: 6, created_at: '2026-05-09T13:20:00Z', actor_name: 'admin@lampang.go.th', action: 'DELETE',  entity_type: 'student',        entity_id: 'STU-099', old_value: { first_name: 'นักเรียนทดสอบ' } },
      { id: 7, created_at: '2026-05-09T14:00:00Z', actor_name: 'province01',          action: 'EXPORT',  entity_type: 'checkin',        entity_id: null,      new_value: { format: 'csv', rows: 1240 } },
    ],
    meta: { page: 1, per_page: 30, total: 7 },
  },
  '/api/province/audit-logs': {
    data: [
      { id: 1, created_at: '2026-05-09T08:30:00Z', actor_name: 'admin@lampang.go.th', action: 'CREATE',  entity_type: 'student',  entity_id: 'STU-001', new_value: { first_name: 'สมชาย' } },
      { id: 2, created_at: '2026-05-09T09:15:00Z', actor_name: 'admin@lampang.go.th', action: 'UPDATE',  entity_type: 'vehicle',  entity_id: 'V-002',   old_value: { plate_no: 'นข 2210 ลำปาง' }, new_value: { plate_no: 'นข 2211 ลำปาง' } },
      { id: 3, created_at: '2026-05-09T10:42:00Z', actor_name: 'school01',            action: 'APPROVE', entity_type: 'roster_request', entity_id: 'REQ-014', new_value: { status: 'approved', requestType: 'add' } },
    ],
    meta: { page: 1, per_page: 30, total: 3 },
  },
  // Phase 3.5 — incident feed widget on Province dashboard.
  // reported_at uses Date.now() relative offsets so the rendered
  // "X minutes ago" timestamps match the moment the QA run executed.
  '/api/province/emergencies': {
    data: [
      {
        id: 1,
        vehicle_id: 'V-001',
        plate_no: 'กข 1234 ลำปาง',
        detail: 'รถแจ้งเหตุฉุกเฉินระหว่างรับนักเรียน — ยางหลังขวาแตก',
        note: 'ประสานโรงเรียนแล้ว รอช่างเปลี่ยนยาง',
        result: null,
        reported_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
        reported_by_name: 'สมชาย ใจดี',
        channel: 'web',
      },
      {
        id: 2,
        vehicle_id: 'V-002',
        plate_no: 'นข 5678 ลำปาง',
        detail: 'ผู้ปกครองแจ้งผ่าน LINE ว่านักเรียนยังไม่ถึงจุดรับ',
        note: '',
        result: null,
        reported_at: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
        reported_by_name: 'LINE OA',
        channel: 'line',
      },
      {
        id: 3,
        vehicle_id: 'V-003',
        plate_no: 'นข 9999 ลำปาง',
        detail: 'รถเสียระหว่างทาง — น้ำมันเครื่องรั่ว',
        note: 'ส่งรถสำรองไปรับนักเรียน',
        result: 'แก้ไขแล้ว',
        reported_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        reported_by_name: 'ทดสอบ คนขับ',
        channel: 'web',
      },
    ],
    meta: { page: 1, per_page: 5, total: 3 },
  },
  // Phase 3.6 — priority vehicles widget on Province dashboard.
  // 5 fixtures hand-picked to cover every priority badge variant in
  // VehicleAtRiskRow so a single capture confirms danger/warn/neutral/
  // success styling all render correctly:
  //   score 150 → danger  (เร่งด่วน)
  //   score  80 → warn    (ต้องติดตาม)
  //   score  60 → warn    (ต้องติดตาม)
  //   score  20 → neutral (ข้อมูลไม่ครบ)
  //   score   0 → success (พร้อมใช้งาน)
  '/api/province/vehicles-at-risk': {
    data: [
      {
        id: 'V-AR01',
        plate_no: 'นข 1010 ลำปาง',
        school_names: 'อนุบาลลำปางเขลางค์รัตน์อนุสรณ์',
        driver_name: 'สมชาย ใจดี',
        student_count: 18,
        latest_inspection_result: 'FAILED',
        latest_inspection_date: '2026-05-05',
        insurance_expiry: '2026-04-15',
        risk_score: 150,
        risk_reasons: ['ไม่ผ่านตรวจ', 'ประกันหมด'],
      },
      {
        id: 'V-AR02',
        plate_no: 'นข 2020 ลำปาง',
        school_names: 'โรงเรียนเทศบาล 1',
        driver_name: 'มานี รักดี',
        student_count: 14,
        latest_inspection_result: null,
        latest_inspection_date: null,
        insurance_expiry: '2026-12-31',
        risk_score: 80,
        risk_reasons: ['ยังไม่ตรวจ'],
      },
      {
        id: 'V-AR03',
        plate_no: 'นข 3030 ลำปาง',
        school_names: 'อนุบาลลำปางเขลางค์รัตน์อนุสรณ์, โรงเรียนเทศบาล 1',
        driver_name: 'วิชัย ขับดี',
        student_count: 22,
        latest_inspection_result: 'NEEDS_FIX',
        latest_inspection_date: '2026-04-20',
        insurance_expiry: '2026-12-31',
        risk_score: 60,
        risk_reasons: ['ต้องแก้ไข'],
      },
      {
        id: 'V-AR04',
        plate_no: 'นข 4040 ลำปาง',
        school_names: 'อนุบาลลำปางเขลางค์รัตน์อนุสรณ์',
        driver_name: 'นพดล ขยัน',
        student_count: 9,
        latest_inspection_result: 'PASSED',
        latest_inspection_date: '2026-03-15',
        insurance_expiry: '2026-05-25',
        risk_score: 20,
        risk_reasons: ['ประกันใกล้หมด'],
      },
      {
        id: 'V-AR05',
        plate_no: 'นข 5050 ลำปาง',
        school_names: 'โรงเรียนเทศบาล 1',
        driver_name: 'อนันต์ ดีเยี่ยม',
        student_count: 12,
        latest_inspection_result: 'PASSED',
        latest_inspection_date: '2026-04-10',
        insurance_expiry: '2027-01-31',
        risk_score: 0,
        risk_reasons: [],
      },
    ],
  },
};

function mockFor(url) {
  // Strip query string + fragment to match by pathname only.
  try {
    const u = new URL(url);
    return MOCK[u.pathname] || null;
  } catch { return null; }
}

async function attachApiStub(page) {
  await page.route(`${BASE}/api/**`, async (route) => {
    const m = mockFor(route.request().url());
    const body = m
      ? JSON.stringify({ success: true, message: 'OK', ...m })
      : JSON.stringify({ success: true, message: 'OK', data: {} });
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
}

async function pageWithUser(browser, user, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.addInitScript(injectScript(user));
  page.on('console',   m => { if (m.type() === 'error') console.log(`    [console.error] ${m.text()}`); });
  page.on('pageerror', e => console.log(`    [pageerror] ${e.message}`));

  // Stub out /api/** so unauth'd dashboard pages don't 401-loop and exhaust
  // resources during visual QA. We're testing UI shell, not backend.
  await attachApiStub(page);

  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-dev-shm-usage',     // /dev/shm is small in containers/VMs
      '--disable-gpu',                // no GPU in headless server
      '--disable-software-rasterizer',
      '--no-sandbox',                 // some environments lack user-ns
    ],
  });

  // Login (no auth)
  for (const [name, vp] of Object.entries({ desktop: VIEWPORTS.desktop, mobile: VIEWPORTS.mobile })) {
    const ctx  = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    await attachApiStub(page);
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 20000 });
    await shoot(page, `01-login-${name}`);
    await ctx.close();
  }

  // Province dashboard — 3 viewports
  for (const [vname, vp] of Object.entries(VIEWPORTS)) {
    const { ctx, page } = await pageWithUser(browser, USERS.province, vp);
    await page.goto(`${BASE}/province`, { waitUntil: 'networkidle', timeout: 20000 });
    await shoot(page, `02-province-${vname}`);
    await ctx.close();
  }

  // School dashboard — desktop + mobile
  for (const [vname, vp] of Object.entries({ desktop: VIEWPORTS.desktop, mobile: VIEWPORTS.mobile })) {
    const { ctx, page } = await pageWithUser(browser, USERS.school, vp);
    await page.goto(`${BASE}/school`, { waitUntil: 'networkidle', timeout: 20000 });
    await shoot(page, `03-school-${vname}`);
    await ctx.close();
  }

  // Driver mobile — bottom nav
  {
    const { ctx, page } = await pageWithUser(browser, USERS.driver, VIEWPORTS.mobile);
    await page.goto(`${BASE}/driver`, { waitUntil: 'networkidle', timeout: 20000 });
    await shoot(page, `04-driver-mobile-home`);

    // Locate by href (i18n-stable) rather than visible label, scoped to the bottom nav.
    const driverTabs = [
      { name: 'requests',  href: '/driver/requests'  },
      { name: 'emergency', href: '/driver/emergency' },
      { name: 'profile',   href: '/driver/profile'   },
      { name: 'home',      href: '/driver'           },
    ];

    // Navigate by URL instead of clicking the bottom-nav link. The pretrip
    // modal renders as a fixed overlay on first driver visit and intercepts
    // taps on the bottom nav, causing Playwright click() to time out. We're
    // capturing visual state per route, not testing the click handler.
    for (const tab of driverTabs) {
      try {
        await page.goto(`${BASE}${tab.href}`, { waitUntil: 'networkidle', timeout: 20000 });
        await shoot(page, `04-driver-mobile-${tab.name}`);
      } catch (e) { console.log(`    skip "${tab.name}": ${e.message.split('\n')[0]}`); }
    }
    await ctx.close();
  }

  // Driver desktop — sidebar, no bottom nav
  {
    const { ctx, page } = await pageWithUser(browser, USERS.driver, VIEWPORTS.desktop);
    await page.goto(`${BASE}/driver`, { waitUntil: 'networkidle', timeout: 20000 });
    await shoot(page, `05-driver-desktop`);
    await ctx.close();
  }

  // Admin sidebar — collapsibility + topbar dropdown
  {
    const { ctx, page } = await pageWithUser(browser, USERS.admin, VIEWPORTS.desktop);
    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle', timeout: 20000 });
    await shoot(page, `06-admin-default`);
    try {
      await page.getByRole('button', { name: /ข้อมูลจังหวัด/ }).first().click({ timeout: 3000 });
      await page.waitForTimeout(300);
      await shoot(page, `06-admin-province-section-toggled`);
    } catch (e) { console.log(`    skip section toggle: ${e.message.split('\n')[0]}`); }
    try {
      await page.getByRole('button', { name: /ผู้ดูแลระบบ|admin/ }).first().click({ timeout: 3000 });
      await page.waitForTimeout(300);
      await shoot(page, `06-admin-profile-dropdown`);
    } catch (e) { console.log(`    skip profile dropdown: ${e.message.split('\n')[0]}`); }
    await ctx.close();
  }

  // Mobile drawer (province)
  {
    const { ctx, page } = await pageWithUser(browser, USERS.province, VIEWPORTS.mobile);
    await page.goto(`${BASE}/province`, { waitUntil: 'networkidle', timeout: 20000 });
    try {
      await page.getByRole('button', { name: 'เปิดเมนู' }).click({ timeout: 3000 });
      await page.waitForTimeout(400);
      await shoot(page, `07-province-mobile-drawer-open`);
      // Two buttons match "ปิดเมนู" (sidebar X + topbar mobile menu) — pick the visible drawer X.
      await page.getByRole('button', { name: 'ปิดเมนู' }).first().click({ timeout: 3000 });
      await page.waitForTimeout(400);
      await shoot(page, `07-province-mobile-drawer-closed`);
    } catch (e) { console.log(`    skip drawer: ${e.message.split('\n')[0]}`); }
    await ctx.close();
  }

  // Toast vs bottom nav (driver mobile) — measure positions
  {
    const { ctx, page } = await pageWithUser(browser, USERS.driver, VIEWPORTS.mobile);
    await page.goto(`${BASE}/driver`, { waitUntil: 'networkidle', timeout: 20000 });
    const toast = await page.evaluate(() => {
      const el = document.querySelector('.fixed.right-4.z-50');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { bottom: cs.bottom, right: cs.right };
    });
    const nav = await page.evaluate(() => {
      const el = document.querySelector('nav[aria-label="เมนูหลัก"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height, viewportH: window.innerHeight };
    });
    console.log(`    toast container computed: ${JSON.stringify(toast)}`);
    console.log(`    bottom-nav rect:           ${JSON.stringify(nav)}`);
    await ctx.close();
  }

  // Phase 3.3 — Reports (RankingTable → LeaderboardRow cards)
  for (const [vname, vp] of Object.entries({ desktop: VIEWPORTS.desktop, mobile: VIEWPORTS.mobile })) {
    const { ctx, page } = await pageWithUser(browser, USERS.province, vp);
    await page.goto(`${BASE}/reports/monthly`, { waitUntil: 'networkidle', timeout: 20000 });
    await shoot(page, `08-reports-monthly-${vname}`);
    await ctx.close();
  }
  for (const [vname, vp] of Object.entries({ desktop: VIEWPORTS.desktop, mobile: VIEWPORTS.mobile })) {
    const { ctx, page } = await pageWithUser(browser, USERS.province, vp);
    await page.goto(`${BASE}/reports/summary`, { waitUntil: 'networkidle', timeout: 20000 });
    await shoot(page, `09-reports-summary-${vname}`);
    await ctx.close();
  }

  // Phase 3.3 — Audit log (AuditLogTable → AuditEntry cards)
  for (const [vname, vp] of Object.entries({ desktop: VIEWPORTS.desktop, mobile: VIEWPORTS.mobile })) {
    const { ctx, page } = await pageWithUser(browser, USERS.admin, vp);
    await page.goto(`${BASE}/admin/audit-logs`, { waitUntil: 'networkidle', timeout: 20000 });
    await shoot(page, `10-admin-audit-${vname}`);
    await ctx.close();
  }

  await browser.close();
  console.log(`\nAll screenshots in ${SHOTS}`);
})();
