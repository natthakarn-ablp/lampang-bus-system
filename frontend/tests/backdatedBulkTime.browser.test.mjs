import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
let server, browser, base;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.TEST_BROWSER ? { executablePath: process.env.TEST_BROWSER } : {}) });
});
after(async () => { await browser?.close(); await server?.close(); });
for (const teacher of [true, false]) for (const session of ['morning', 'evening']) test(`past bulk ${teacher ? 'grade' : 'school'} ${session}`, async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  const writes = [], faults = [], network = [];
  page.on('pageerror', e => faults.push(e.message)); page.on('requestfailed', r => network.push(r.url()));
  await page.addInitScript(teacher => {
    localStorage.setItem('access_token', 'synthetic'); localStorage.setItem('features', '{}');
    localStorage.setItem('user', JSON.stringify({ id: 7, role: 'school', scope_id: 'TEST', display_name: 'ทดสอบ', ...(teacher ? { gradeScope: 'ป.4' } : {}) }));
  }, teacher);
  let selectedDate;
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const url = new URL(route.request().url()); let data = {};
    if (url.pathname.endsWith('/backdated-attendance')) {
      selectedDate = url.searchParams.get('date');
      const stamp = new Date(`${selectedDate}T08:00:00+07:00`).toISOString();
      const pupils = [
        [1, '1', 'bus'], [2, '2', 'bus'], [3, '1', 'LEAVE'], [4, '1', 'SELF'], [5, '1', 'pending'],
      ].map(([id, room, kind]) => ({ id, name: `นักเรียนทดสอบ ${id}`, grade: 'ป.4', classroom: room,
        ...Object.fromEntries(['morning','evening'].map(round => [round, { enabled: true, done: kind === 'bus',
          leave: ['LEAVE','SELF'].includes(kind) ? kind : null,
          ...(kind === 'SELF' ? { self_id: 204, self_recorded_at: stamp, self_session: round } : {}),
          logs: kind === 'bus' ? [{ log_id: 100 + id, status: round === 'morning' ? 'CHECKED_OUT' : 'CHECKED_IN', checked_at: stamp, time: '08:00' }] : [],
        }])) }));
      data = { check_date: selectedDate, students: pupils, grade_scope: teacher ? 'ป.4' : null };
    }
    if (route.request().method() === 'PATCH') { writes.push(route.request().postDataJSON()); data = { updated: writes.at(-1).entries.length }; }
    await route.fulfill({ json: { success: true, data } });
  });
  try {
    await page.goto(`${base}/school/backdated-attendance`);
    await page.getByText('นักเรียนทดสอบ 1', { exact: true }).waitFor();
    const open = page.getByRole('button', { name: 'ปรับเวลาเช็กชื่อทั้งสายชั้น / ห้อง', exact: true });
    if (!teacher) { assert.equal(await open.isDisabled(), true); await page.getByLabel('สายชั้นที่ต้องการปรับเวลา').selectOption('ป.4'); }
    if (session === 'evening') await page.getByRole('radio', { name: 'รอบเย็น', exact: true }).click();
    await open.click(); const dialog = page.getByRole('alertdialog', { name: 'ปรับเวลาเช็กชื่อทั้งสายชั้น', exact: true });
    assert.match(await dialog.innerText(), /จะปรับ 3 รายการ/);
    await dialog.getByLabel('ห้องที่ต้องการปรับเวลา').selectOption({ label: 'ห้อง 1' });
    assert.match(await dialog.innerText(), /จะปรับ 2 รายการ/);
    const small = await dialog.locator('button,input,select').evaluateAll(nodes => nodes.filter(n => {const r = n.getBoundingClientRect(); return r.width > 0 && r.height < 44;}).length);
    assert.equal(small, 0); assert.equal(await page.getByLabel('วันที่', { exact: true }).isDisabled(), true);
    await dialog.getByLabel('เวลาใหม่ตามที่เกิดขึ้นจริง').fill(session === 'morning' ? '08:15' : '16:30');
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/backdated-dialog-${teacher ? 'grade' : 'school'}-${session}.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'บันทึกเวลา 2 รายการ', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(writes.length, 1); assert.equal(writes[0].check_date, selectedDate); assert.equal(writes[0].session, session);
    assert.deepEqual(writes[0].entries.map(e => [e.kind,e.id]), [['bus',101],['self',204]]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(faults, []);
    console.log(JSON.stringify({ teacher, session, environmentalNetwork: network }));
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/backdated-${teacher ? 'grade' : 'school'}-${session}.png`, fullPage: true });
  } finally { await context.close(); }
});
