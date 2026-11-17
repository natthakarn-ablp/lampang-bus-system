import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
let server, browser, base;
before(async () => {
  server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.TEST_BROWSER ? { executablePath: process.env.TEST_BROWSER } : {}) });
});
after(async () => { await browser?.close(); await server?.close(); });
async function session(role = 'school', extra = {}, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  await page.addInitScript(user => {
    localStorage.setItem('access_token', 'synthetic'); localStorage.setItem('refresh_token', 'synthetic');
    localStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('features', '{}');
  }, { id: 7, role, scope_type: 'SCHOOL', scope_id: 'TEST', ...extra });
  return { page, context };
}
for (const width of [390, 1280]) test(`school reset credentials survive reload and close explicitly ${width}`, async () => {
  const { page, context } = await session('school', {}, width); let gets = 0, resets = 0;
  await page.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.syntheticClipboard = text; } } }); });
  const faults = []; page.on('pageerror', e => faults.push(e.message));
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname; let data = {};
    if (path === '/api/school/vehicles') { gets++; data = [{ id: 1, plate_no: 'รถทดสอบ', student_count: 1 }]; }
    if (path.endsWith('/driver/reset-password')) { resets++; data = { username: 'รถทดสอบ', temporary_password: 'SyntheticOnly123!' }; }
    await route.fulfill({ json: { success: true, data } });
  });
  try {
    await page.goto(`${base}/school/vehicles`);
    await page.getByRole('button', { name: 'รีเซ็ตรหัสผ่านคนขับ', exact: true }).waitFor();
    const initialGets = gets;
    await page.getByRole('button', { name: 'รีเซ็ตรหัสผ่านคนขับ', exact: true }).click();
    await page.getByRole('button', { name: 'รีเซ็ตรหัสผ่าน', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'รหัสผ่านชั่วคราวของคนขับ' });
    await dialog.getByText('SyntheticOnly123!', { exact: true }).waitFor();
    await page.waitForTimeout(250); assert.equal(gets, initialGets); assert.equal(resets, 1);
    await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true);
    await dialog.getByRole('button', { name: 'คัดลอกชื่อผู้ใช้และรหัสผ่าน' }).click();
    assert.ok((await page.evaluate(() => window.syntheticClipboard)).includes('SyntheticOnly123!'));
    assert.equal(await dialog.isVisible(), true);
    await dialog.getByRole('button', { name: 'บันทึกรหัสแล้ว ปิดหน้าต่าง' }).click();
    await page.waitForFunction(() => !document.body.textContent.includes('SyntheticOnly123!'));
    await page.waitForTimeout(250); assert.equal(gets, initialGets + 1); assert.equal(resets, 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(faults, []);
  } finally { await context.close(); }
});
test('bulk time conflict is explained and editable for retry', async () => {
  const { page, context } = await session('school', { grade_scope: 'ป.4' }); let attempts = 0;
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname; let data = {};
    if (path === '/api/school/teacher-check') data = { vehicles: [{ vehicle_id: 'TEST', plate_no: 'รถทดสอบ', students: [{ id: 1, name: 'นักเรียนทดสอบ', grade: 'ป.4', classroom: '1', done: true, log_id: 11, checked_at: '2026-11-17T01:30:00Z', status: 'CHECKED_OUT' }] }], homerooms: [] };
    if (path === '/api/school/attendance-times') {
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 409, json: { success: false, message: 'เวลาไม่เรียง', errors: [{ code: 'EVENT_TIME_ORDER', entry_index: 0, earliest_time: '08:00', latest_time: null }] } });
      data = { updated: 1 };
    }
    await route.fulfill({ json: { success: true, data } });
  });
  try {
    await page.goto(`${base}/school/teacher-check?session=morning`);
    await page.getByRole('button', { name: 'ปรับเวลาเช็กชื่อทั้งสายชั้น / ห้อง', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'ปรับเวลาเช็กชื่อทั้งสายชั้น' });
    await dialog.locator('input[type=time]').fill('07:30');
    await dialog.getByRole('button', { name: 'บันทึกเวลา 1 รายการ', exact: true }).click();
    await dialog.getByText(/ต้องไม่ก่อน 08:00/).waitFor();
    assert.ok((await dialog.innerText()).includes('ยังไม่ได้เปลี่ยนเวลาทั้งชุด'));
    await dialog.locator('input[type=time]').fill('08:15');
    assert.equal(await dialog.getByRole('button', { name: 'บันทึกเวลา 1 รายการ', exact: true }).isEnabled(), true);
    await dialog.getByRole('button', { name: 'บันทึกเวลา 1 รายการ', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' }); assert.equal(attempts, 2);
  } finally { await context.close(); }
});
test('forced password change can logout without opening protected home', async () => {
  const { page, context } = await session('school', { must_change_password: true }); const writes = [];
  await page.route(url => url.pathname.startsWith('/api/'), async route => { if (route.request().method() !== 'GET') writes.push(new URL(route.request().url()).pathname); await route.fulfill({ json: { success: true, data: {} } }); });
  try { await page.goto(`${base}/change-password`); await page.getByRole('button', { name: 'ออกจากระบบ / เปลี่ยนบัญชี' }).click(); await page.waitForURL('**/login'); assert.deepEqual(writes.filter(path => path !== '/api/visits/track'), ['/api/auth/logout']); assert.equal(await page.evaluate(() => localStorage.getItem('access_token')), null); }
  finally { await context.close(); }
});
test('forgot-password request keeps generic response and shows offline recovery route', async () => {
  const { page, context } = await session(); const writes = [];
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    if (route.request().method() !== 'GET') writes.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: { success: true, data: { policy: { enabled_roles: ['school', 'driver'] } } } });
  });
  try { await page.goto(`${base}/forgot-password`); await page.getByLabel('ชื่อผู้ใช้').fill('synthetic'); await page.getByRole('button', { name: 'ส่งลิงก์ไปยัง LINE' }).click(); await page.getByText(/คำขอนี้ยังไม่เปลี่ยนรหัสผ่านเดิม/).waitFor(); await page.getByText('ยังไม่ผูก LINE หรือไม่ได้รับลิงก์?', { exact: true }).click(); await page.getByText('ติดต่อโรงเรียนที่ใช้รถคันนี้ให้รีเซ็ตรหัสผ่าน', { exact: false }).waitFor(); assert.deepEqual(writes.filter(path => path !== '/api/visits/track'), ['/api/auth/recovery/request']); }
  finally { await context.close(); }
});
test('grade dashboard separates unassigned pupils and actual vehicles', async () => {
  const { page, context } = await session('school', { grade_scope: 'ป.4' });
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname; let data = {};
    if (path === '/api/school/dashboard') data = { date, is_school_day: true, school: { name: 'โรงเรียนทดสอบ' }, total_students: 3, total_vehicles: 1, morning_done: 1, morning_total: 2, evening_total: 2, evening_done: 0, completeness: { students_total: 3, students_with_vehicle: 2, students_with_parent: 3 } };
    if (path === '/api/school/status-today') data = { vehicles: [
      { vehicle_id: 1, plate_no: 'รถทดสอบ', students: [{ id: 1, name: 'ทดสอบมีรถ', grade: 'ป.4', classroom: '1', morning_enabled: true, morning_done: false }] },
      { vehicle_id: null, plate_no: 'ไม่มีรถ', students: [{ id: 2, name: 'ทดสอบไม่มีรถ', grade: 'ป.4', classroom: '1', morning_enabled: true, morning_done: false, no_vehicle: true }] },
    ] };
    if (path === '/api/school/leaves') data = [];
    if (path === '/api/reports/monthly') data = { daily_trend: [{ date, morning_pct: 33, evening_pct: 0 }] };
    await route.fulfill({ json: { success: true, data } });
  });
  try {
    await page.goto(`${base}/school`);
    await page.getByRole('heading', { name: 'ภาพรวมชั้น ป.4', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'ข้อมูลที่ควรตรวจสอบ' }).waitFor();
    const vehicleSummary = page.getByRole('button', { name: /สถานะรถแต่ละคัน/ });
    assert.ok((await vehicleSummary.innerText()).includes('1 คัน'));
    assert.equal(await page.getByRole('heading', { name: 'งานรออนุมัติ', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const trend = page.getByRole('button', { name: /แนวโน้มและรายรถ/ });
    await trend.click();
    await page.getByText(/วันนี้ใช้จำนวนผู้ใช้รถที่คาดหมายเดียวกับสรุปรอบด้านบน/).waitFor();
    await page.getByText('50%', { exact: true }).waitFor();
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/dashboard-grade-mobile.png`, fullPage: true });
  } finally { await context.close(); }
});
