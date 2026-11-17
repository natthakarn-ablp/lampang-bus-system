import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
let server, browser, base;
before(async () => { server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 } }); await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}`; browser = await chromium.launch({ headless: true, ...(process.env.TEST_BROWSER ? { executablePath: process.env.TEST_BROWSER } : {}) }); });
after(async () => { await browser?.close(); await server?.close(); });
async function makePage(width, role = null) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  if (role) await page.addInitScript(role => { localStorage.setItem('access_token', 'synthetic'); localStorage.setItem('user', JSON.stringify({ id: 9, role, username: 'TEST-PLATE', scope_id: 'TEST' })); localStorage.setItem('features', '{}'); }, role);
  return { context, page };
}
for (const width of [390, 1280]) for (const role of [null, 'school', 'parent']) test(`public history/help ${role || 'anonymous'} ${width}`, async () => {
  const { context, page } = await makePage(width, role); const errors = []; const writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(url => url.pathname.startsWith('/api/'), async route => { if (route.request().method() !== 'GET') writes.push(new URL(route.request().url()).pathname); await route.fulfill({ json: { success: true, data: {} } }); });
  try {
    await page.goto(`${base}/updates`); await page.getByRole('heading', { name: 'ประวัติการอัปเดต', exact: true }).waitFor(); await page.getByRole('heading', { name: 'รุ่น 2.2.0', exact: true }).waitFor(); await page.getByRole('heading', { name: 'รุ่น 2.1.0', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('link', { name: 'วิธีแจ้งปัญหา', exact: true }).click(); await page.getByRole('heading', { name: 'แจ้งปัญหาและขอความช่วยเหลือ', exact: true }).waitFor();
    assert.ok((await page.locator('main').innerText()).includes('ไม่ส่งรหัสผ่าน')); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []); assert.ok(writes.every(path => path === '/api/visits/track'));
    for (const link of await page.locator('main a').all()) assert.ok((await link.boundingBox()).height >= 44);
    if (process.env.SCREENSHOT_DIR && !role && width === 390) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/help-mobile.png`, fullPage: true });
  } finally { await context.close(); }
});
for (const width of [390, 1280]) for (const status of [400, 500]) test(`pretrip probe failure blocks submit and supports retry ${status} ${width}`, async () => {
  const { context, page } = await makePage(width, 'driver'); let healthy = false; let saves = 0; let reads = 0;
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname; const method = route.request().method();
    if (path === '/api/driver/pretrip-status') { reads++; return healthy ? route.fulfill({ json: { success: true, data: { done: false } } }) : route.fulfill({ status, json: { success: false, message: status === 400 ? 'Multiple active vehicles assigned to this driver — please contact admin' : 'Internal server error', errors: [{ code: 'MULTIPLE_ACTIVE_DRIVER_ASSIGNMENTS' }] } }); }
    if (path === '/api/driver/pretrip' && method === 'POST') { saves++; return route.fulfill({ json: { success: true, data: {} } }); }
    await route.fulfill({ json: { success: true, data: {} } });
  });
  try {
    await page.goto(`${base}/driver/pretrip`); await page.locator('strong').getByText('TEST-PLATE', { exact: true }).waitFor(); await page.getByRole('alert').getByText('ยังตรวจสอบรถของบัญชีนี้ไม่ได้', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'ทุกรายการปกติ — ออกได้', exact: true }).count(), 0); assert.equal(saves, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (process.env.SCREENSHOT_DIR && status === 400 && width === 390) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/pretrip-blocked-mobile.png`, fullPage: true });
    healthy = true; await page.getByRole('button', { name: 'ลองใหม่อีกครั้ง', exact: true }).click(); await page.getByRole('button', { name: 'ทุกรายการปกติ — ออกได้', exact: true }).waitFor(); assert.ok(reads >= 2);
    await page.getByRole('button', { name: 'ทุกรายการปกติ — ออกได้', exact: true }).click(); await page.getByText('ตรวจรถเรียบร้อย — ออกเดินทางได้', { exact: true }).waitFor(); assert.equal(saves, 1);
  } finally { await context.close(); }
});
for (const reviewMode of [false, true]) test(`policy remains informational and does not acknowledge draft ${reviewMode}`, async () => {
  const { context, page } = await makePage(390, 'school'); const writes = [];
  await page.route(url => url.pathname.startsWith('/api/'), async route => { const path = new URL(route.request().url()).pathname; if (route.request().method() !== 'GET') writes.push(path); await route.fulfill({ json: { success: true, data: path === '/api/policy-notices/catalog' ? { enabled: reviewMode, reviewMode, policies: [] } : {} } }); });
  try { await page.goto(`${base}/my-policy`); await page.getByRole('heading', { name: 'ข้อมูลที่หน่วยงานต้องยืนยันก่อนประกาศฉบับจริง' }).waitFor(); assert.ok(!(await page.locator('body').innerText()).includes('21 ตุลาคม 2569')); assert.ok(!writes.some(path => path.startsWith('/api/policy-notices/'))); assert.equal(await page.getByRole('button', { name: /ยอมรับ|รับทราบ/ }).count(), 0); }
  finally { await context.close(); }
});
for (const kind of ['asset', 'unknown']) test(`ErrorBoundary safe recovery ${kind}`, async () => {
  const { context, page } = await makePage(390); let loads = 0; page.on('framenavigated', frame => { if (frame === page.mainFrame()) loads++; });
  try { await page.goto(`${base}/tests/fixtures/error-boundary.html?kind=${kind}`); await page.getByText(`รหัสปัญหา: ${kind === 'asset' ? 'UI-ASSET-LOAD' : 'UI-UNEXPECTED'}`, { exact: true }).waitFor(); await page.getByRole('button', { name: 'รีเฟรชหน้า', exact: true }).waitFor(); await page.waitForTimeout(200); assert.equal(loads, 1); assert.ok((await page.locator('body').innerText()).includes('ข้อมูลที่ยังไม่ได้บันทึกอาจสูญหาย')); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); await page.getByRole('link', { name: 'วิธีแจ้งปัญหา' }).waitFor(); }
  finally { await context.close(); }
});
