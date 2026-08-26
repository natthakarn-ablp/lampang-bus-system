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

const SCENARIOS = {
  // round not started — the case the old UI wrongly showed as a big warning
  normal: {
    '/api/province/dashboard': { data: dash({ morning_done: 3980, morning_total: 4654, evening_total: 4651, morning_pending: 674 }) },
    '/api/admin/users':                 { data: [], meta: { page: 1, per_page: 1, total: 276 } },
    '/api/admin/users?is_active=false': { data: [], meta: { page: 1, per_page: 5, total: 643 } },
    '/api/admin/users-needing-action': { data: { total: 643, rows: [
      { id: 101, username: 'user-a', display_name: 'ผู้ใช้ตัวอย่าง ก', is_active: true,  must_change_password: true },
      { id: 102, username: 'user-b', display_name: 'ผู้ใช้ตัวอย่าง ข', is_active: true,  must_change_password: true },
      { id: 103, username: 'user-c', display_name: 'ผู้ใช้ตัวอย่าง ค', is_active: false, must_change_password: false },
    ] } },
    '/api/admin/roster-requests-pending': { data: { total: 0, rows: [] } },
    '/api/admin/audit-logs': { data: [], meta: { total: 0 } },
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
  await page.addInitScript(`
    localStorage.setItem('access_token',  ${JSON.stringify(FAKE_TOKEN)});
    localStorage.setItem('refresh_token', ${JSON.stringify(FAKE_TOKEN)});
    localStorage.setItem('user',          ${JSON.stringify(JSON.stringify(user))});
  `);
  page.on('console',   m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

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
  return { ctx, page, errors };
}

const MEASURE = `(() => {
  const de = document.documentElement;
  const small = [...document.querySelectorAll('button,a,input,select,[role=button]')]
    .map(e => { const b = e.getBoundingClientRect();
      return { label: (e.getAttribute('aria-label') || e.textContent || e.placeholder || '').trim().slice(0, 32),
               w: Math.round(b.width), h: Math.round(b.height) }; })
    .filter(e => e.h > 0 && (e.h < 44 || e.w < 44));
  const tinyInputs = [...document.querySelectorAll('input,select,textarea')]
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
];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const report = [];

  for (const shot of SHOTS) {
    if (ONLY && !shot.id.includes(ONLY)) continue;
    for (const vname of shot.vps) {
      const name = `${shot.id}-${vname}`;
      const user = shot.user ? USERS[shot.user] : { role: 'none' };
      const { ctx, page, errors } = await newPage(browser, user, VIEWPORTS[vname], shot.scenario || 'normal');
      let metrics = null, failed = null;
      try {
        await page.goto(BASE + shot.url, { waitUntil: 'networkidle', timeout: 25000 });
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
        metrics = await page.evaluate(MEASURE);
      } catch (e) { failed = e.message.split('\n')[0]; }
      await ctx.close();

      const rec = { name, url: shot.url, role: shot.user || 'public',
                    scenario: shot.scenario || 'normal', metrics, errors, failed };
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
  console.log(`\n── ${TAG} summary ──`);
  console.log(`  captures: ${report.length}`);
  console.log(`  horizontal overflow: ${overflow.length}${overflow.length ? ' → ' + overflow.map(r => r.name).join(', ') : ''}`);
  console.log(`  console errors:      ${withErr.length}${withErr.length ? ' → ' + withErr.map(r => r.name).join(', ') : ''}`);
  console.log(`  failed captures:     ${failed.length}${failed.length ? ' → ' + failed.map(r => r.name).join(', ') : ''}`);
  console.log(`  → ${OUT}`);
})();
