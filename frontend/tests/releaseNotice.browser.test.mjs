import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
let server, browser, base;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.TEST_BROWSER ? { executablePath: process.env.TEST_BROWSER } : {}) });
});
after(async () => { await browser?.close(); await server?.close(); });
const audiences = [
  ['school', '', 'บัญชีโรงเรียน'], ['school', 'ป.4', 'ครูขอบเขตสายชั้น'], ['driver', '', 'ผู้ขับรถ'],
  ['parent', '', 'ผู้ปกครอง'], ['affiliation', '', 'สังกัด'], ['province', '', 'จังหวัด'],
  ['transport', '', 'ขนส่ง'], ['admin', '', 'ผู้ดูแลระบบ'],
];
for (const width of [390, 1280]) for (const [role, grade, title] of audiences) test(`release notice ${role}${grade} ${width}px`, async () => {
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); const errors = []; const apiCalls = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(url => url.pathname.startsWith('/api/'), async route => { apiCalls.push(route.request().url()); await route.abort(); });
  try {
    await page.goto(`${base}/tests/fixtures/release-notice.html?role=${role}&grade=${encodeURIComponent(grade)}`);
    const notice = page.getByRole('complementary', { name: 'ข่าวอัปเดตระบบ' });
    const summary = notice.locator('summary'); await summary.waitFor();
    assert.equal(await notice.locator('details').getAttribute('open'), null);
    assert.ok((await summary.boundingBox()).height >= 44);
    await summary.focus(); await page.keyboard.press('Enter');
    await notice.getByRole('heading', { name: `สำหรับ${title}`, exact: true }).waitFor();
    assert.ok((await notice.innerText()).includes('ระบบไม่ได้เปลี่ยนย้อนหลังเป็นลาทั้งวัน'));
    assert.equal(await notice.getByRole('link', { name: 'ไปหน้าเช็กชื่อวันนี้' }).count(), role === 'school' ? 1 : 0);
    if (grade) assert.ok((await notice.innerText()).includes(`สายชั้น ${grade}`));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []); assert.deepEqual(apiCalls, []);
    if (process.env.SCREENSHOT_DIR && grade && width === 390) {
      await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/teacher-notice-mobile.png`, fullPage: true });
    }
    await summary.focus(); await page.keyboard.press('Enter');
    assert.equal(await notice.locator('details').getAttribute('open'), null);
  } finally { await context.close(); }
});
