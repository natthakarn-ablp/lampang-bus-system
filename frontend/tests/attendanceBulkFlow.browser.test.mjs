import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
let server, browser, base;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 } }); await server.listen();
  base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.TEST_BROWSER ? { executablePath: process.env.TEST_BROWSER } : {}) });
});
after(async () => { await browser?.close(); await server?.close(); });
for (const gradeTeacher of [true, false]) test(`bulk time and linked leave: ${gradeTeacher ? 'grade' : 'school'} account`, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(8000); const writes = []; const faults = []; const network = [];
  page.on('pageerror', e => faults.push(e.message));
  page.on('console', e => { if (e.type() === 'error') faults.push(e.text()); });
  page.on('response', r => { if (r.status() >= 400) faults.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', r => network.push(r.url()));
  const pupils = [
    { id: 1, name: 'นักเรียนทดสอบ ก', grade: 'ป.4', classroom: '1', done: true, log_id: 101, status: 'CHECKED_OUT', checked_at: '2026-11-17T01:00:00Z' },
    { id: 2, name: 'นักเรียนทดสอบ ข', grade: 'ป.4', classroom: '2', done: true, log_id: 102, status: 'CHECKED_OUT', checked_at: '2026-11-17T01:00:00Z' },
    { id: 3, name: 'นักเรียนทดสอบ ค', grade: 'ป.4', classroom: '1' },
  ];
  await page.addInitScript(teacher => {
    localStorage.setItem('access_token', 'synthetic-test');
    localStorage.setItem('user', JSON.stringify({ id: 7, role: 'school', scope_id: 'TEST', display_name: 'ครูทดสอบ', ...(teacher ? { grade_scope: 'ป.4' } : {}) }));
    localStorage.setItem('features', '{}');
  }, gradeTeacher);
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const url = new URL(route.request().url()); const method = route.request().method();
    let data = {};
    if (url.pathname === '/api/school/teacher-check' && method === 'GET') data = { vehicles: [{ vehicle_id: 'V-test', plate_no: 'รถทดสอบ', students: pupils }], homerooms: [] };
    if (method !== 'GET') {
      const body = route.request().postDataJSON(); writes.push({ path: url.pathname, body });
      if (url.pathname === '/api/school/attendance-times') data = { updated: body.entries.length };
      if (url.pathname === '/api/school/leave') Object.assign(pupils[2], { on_leave: true, leave_session: body.session });
    }
    await route.fulfill({ json: { success: true, data } });
  });
  try {
    await page.goto(`${base}/school/teacher-check?session=morning`);
    if (!gradeTeacher) await page.getByLabel('สายชั้นที่ต้องการเช็กชื่อ').selectOption('ป.4');
    await page.getByRole('button', { name: 'ปรับเวลาเช็กชื่อทั้งสายชั้น / ห้อง', exact: true }).click();
    let dialog = page.getByRole('alertdialog', { name: 'ปรับเวลาเช็กชื่อทั้งสายชั้น' });
    assert.match(await dialog.innerText(), /จะปรับ 2 รายการ/);
    await dialog.getByLabel('ห้องที่ต้องการปรับเวลา').selectOption({ label: 'ห้อง 1' });
    assert.match(await dialog.innerText(), /จะปรับ 1 รายการ/);
    await dialog.getByLabel('เวลาใหม่ตามที่เกิดขึ้นจริง').fill('08:15');
    const small = await dialog.locator('button, input, select').evaluateAll(nodes => nodes.filter(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height < 44; }).map(n => n.tagName));
    assert.deepEqual(small, []);
    if (process.env.SCREENSHOT_DIR) {
      await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${gradeTeacher ? 'grade' : 'school'}-bulk-time.png`, fullPage: true });
    }
    await dialog.getByRole('button', { name: 'บันทึกเวลา 1 รายการ', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const bulk = writes.find(w => w.path.endsWith('attendance-times'));
    assert.deepEqual(bulk.body.entries.map(e => e.id), [101]);
    assert.equal(bulk.body.session, 'morning');
    assert.equal(await page.getByLabel('เมื่อเลือกลา').inputValue(), 'both');
    await page.getByRole('button', { name: 'เลือกลา นักเรียนทดสอบ ค', exact: true }).click();
    await page.getByRole('button', { name: 'ยืนยันรายคน นักเรียนทดสอบ ค', exact: true }).click();
    await page.getByText('ลาทั้งวันแล้ว', { exact: true }).waitFor();
    assert.equal(writes.find(w => w.path.endsWith('/leave')).body.session, 'both');
    await page.getByRole('tab', { name: 'เย็น · กลับบ้าน', exact: true }).click();
    await page.getByText('ลาทั้งวันแล้ว', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'ยืนยันรายคน นักเรียนทดสอบ ค', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(faults, []);
    console.log(JSON.stringify({ role: gradeTeacher ? 'grade' : 'school', environmentalNetwork: network }));
  } catch (error) { console.log({ faults, network, url: page.url(), body: (await page.locator('body').innerText()).slice(0, 2000) }); throw error; } finally { await context.close(); }
});
