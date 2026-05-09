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

async function pageWithUser(browser, user, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.addInitScript(injectScript(user));
  page.on('console',   m => { if (m.type() === 'error') console.log(`    [console.error] ${m.text()}`); });
  page.on('pageerror', e => console.log(`    [pageerror] ${e.message}`));

  // Stub out /api/** so unauth'd dashboard pages don't 401-loop and exhaust
  // resources during visual QA. We're testing UI shell, not backend.
  await page.route(`${BASE}/api/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: 'OK', data: {} }),
    });
  });

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
    await page.route(`${BASE}/api/**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'OK', data: {} }),
      });
    });
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

  await browser.close();
  console.log(`\nAll screenshots in ${SHOTS}`);
})();
