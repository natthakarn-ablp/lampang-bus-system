import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// Synthetic fixtures only; these are not production school/student counts.
const fixture = {
  affiliation: { id: 7, name: 'สังกัดทดสอบ' },
  generated_at: '2026-10-21T03:30:00.000Z',
  summary: { total_schools: 2, total_students: 20, total_vehicles: 4 },
  schools: [
    { id: 1, name: 'โรงเรียนทดสอบ ก', student_count: 12, vehicle_count: 3 },
    { id: 2, name: 'โรงเรียนทดสอบ ข', student_count: 8, vehicle_count: 2 },
  ],
};
let server;
let browser;
let baseURL;

before(async () => {
  server = await createServer({
    server: { host: '127.0.0.1', port: 0, strictPort: false },

  });
  await server.listen();
  baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.SCHOOL_REPORT_BROWSER ? { executablePath: process.env.SCHOOL_REPORT_BROWSER } : {}),
  });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function openReport(data = fixture, options = {}) {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: options.viewport || { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    if (options.onRequest) return options.onRequest(route);
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`${baseURL}/tests/fixtures/school-report.html`);
  await page.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0, { timeout: 10000 }).catch(async (error) => {
    console.error('Harness failed:', errors, await page.locator('body').innerText());
    throw error;
  });
  return { page, context, errors };
}

test('header summary uses server-deduplicated vehicle total, not the per-school sum', async () => {
  const { page, context, errors } = await openReport();
  try {
    await page.getByRole('heading', { name: 'โรงเรียนในสังกัด', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    const summary = page.getByRole('region', { name: 'สรุปโรงเรียนในสังกัด', exact: true });
    await summary.waitFor({ timeout: 5000 });
    assert.equal(await summary.getByTestId('total-schools').textContent(), '2');
    assert.equal(await summary.getByTestId('total-students').textContent(), '20');
    assert.equal(await summary.getByTestId('total-vehicles').textContent(), '4');
    assert.equal(await page.getByRole('heading', { name: 'โรงเรียนทดสอบ ก', exact: true }).count(), 1);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('report dialog shows the affiliation, every school, and unique totals and closes with Escape', async () => {
  const data = structuredClone(fixture);
  data.schools[0].name = '<img src=x onerror=alert(1)> โรงเรียนทดสอบ';
  const { page, context, errors } = await openReport(data);
  try {
    await page.getByRole('button', { name: 'ดูรายงาน', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'รายงานสรุปโรงเรียนในสังกัด', exact: true });
    await dialog.waitFor({ timeout: 3000 });
    assert.ok((await dialog.innerText()).includes('สังกัดทดสอบ'));
    assert.ok((await dialog.innerText()).includes(data.schools[0].name));
    assert.equal(await dialog.locator('img').count(), 0);
    assert.equal(await dialog.locator('tbody tr').count(), 2);
    assert.deepEqual(await dialog.locator('tfoot td').allTextContents(), ['รวมทั้งสังกัด (รถไม่นับซ้ำ)', '20', '4']);
    assert.equal(await dialog.getByRole('button', { name: 'พิมพ์ / บันทึก PDF', exact: true }).count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    assert.equal(await page.getByRole('button', { name: 'ดูรายงาน', exact: true }).evaluate((el) => el === document.activeElement), true);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Excel action downloads the authenticated, admin-scoped response bytes', async () => {
  // Only tests browser download transport; backend tests validate actual XLSX structure.
  const responseBytes = Buffer.from('synthetic download transport fixture');
  let requestedURL;
  const { page, context } = await openReport(fixture, {
    onRequest: async (route) => {
      if (new URL(route.request().url()).pathname.endsWith('/excel')) {
        requestedURL = route.request().url();
        assert.equal(route.request().headers().authorization, 'Bearer test-only-token');
        await route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: responseBytes });
      } else await route.fulfill({ json: { success: true, data: fixture } });
    },
  });
  try {
    await page.evaluate(() => {
      localStorage.setItem('access_token', 'test-only-token');
      localStorage.setItem('user', JSON.stringify({ role: 'admin' }));
      sessionStorage.setItem('admin_affiliation_id', '7');
    });
    const downloadPromise = page.waitForEvent('download', { timeout: 4000 });
    await page.getByRole('button', { name: 'ส่งออก Excel', exact: true }).click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^affiliation-schools-.*\.xlsx$/);
    assert.equal(new URL(requestedURL).pathname, '/api/affiliation/schools/report/excel');
    assert.equal(new URL(requestedURL).searchParams.get('affiliation_id'), '7');
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), responseBytes);
    await page.getByRole('status').filter({ hasText: 'ดาวน์โหลด Excel สำเร็จ' }).waitFor();
  } finally { await context.close(); }
});

test('failed loading is not misreported as zero schools and retry recovers', async () => {
  let attempt = 0;
  const { page, context } = await openReport(fixture, { onRequest: async (route) => {
    attempt += 1;
    if (attempt === 1) await route.fulfill({ status: 503, json: { message: 'บริการรายงานไม่พร้อม' } });
    else await route.fulfill({ json: { success: true, data: fixture } });
  }});
  try {
    await page.getByText('บริการรายงานไม่พร้อม', { exact: true }).waitFor();
    assert.equal(await page.getByText('ยังไม่มีโรงเรียนในสังกัด', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'ส่งออก Excel', exact: true }).isDisabled(), true);
    assert.equal(await page.getByTestId('total-students').textContent(), '–');
    await page.getByRole('button', { name: 'ลองใหม่อีกครั้ง', exact: true }).click();
    await page.getByRole('heading', { name: 'โรงเรียนทดสอบ ก', exact: true }).waitFor();
    assert.equal(await page.getByTestId('total-students').textContent(), '20');
    assert.equal(attempt, 2);
  } finally { await context.close(); }
});

test('empty affiliation is a valid zero report that remains viewable', async () => {
  const data = { ...fixture, schools: [], summary: { total_schools: 0, total_students: 0, total_vehicles: 0 } };
  const { page, context, errors } = await openReport(data);
  try {
    await page.getByText('ยังไม่มีโรงเรียนในสังกัด', { exact: true }).waitFor();
    assert.equal(await page.getByTestId('total-vehicles').textContent(), '0');
    assert.equal(await page.getByRole('button', { name: 'ส่งออก Excel', exact: true }).isEnabled(), true);
    await page.getByRole('button', { name: 'ดูรายงาน', exact: true }).click();
    const dialog = page.getByRole('dialog');
    assert.deepEqual(await dialog.locator('tfoot td').allTextContents(), ['รวมทั้งสังกัด (รถไม่นับซ้ำ)', '0', '0']);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('Excel errors retain the overview and allow another export attempt', async () => {
  const { page, context } = await openReport(fixture, { onRequest: async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/excel')) {
      await route.fulfill({ status: 500, json: { message: 'synthetic export failure' } });
    } else await route.fulfill({ json: { success: true, data: fixture } });
  }});
  try {
    await page.getByRole('button', { name: 'ส่งออก Excel', exact: true }).click();
    await page.getByText('ดาวน์โหลด Excel ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'ส่งออก Excel', exact: true }).isEnabled(), true);
    assert.equal(await page.getByTestId('total-students').textContent(), '20');
    assert.equal(await page.getByText('ดาวน์โหลด Excel สำเร็จ', { exact: true }).count(), 0);
  } finally { await context.close(); }
});

test('summary and report fit narrow phones without horizontal page overflow', async () => {
  for (const width of [320, 390, 768, 1280]) {
    const { page, context, errors } = await openReport(fixture, { viewport: { width, height: 900 } });
    try {
      await page.getByRole('heading', { name: 'โรงเรียนทดสอบ ก', exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overview overflow at ${width}`);
      if (width === 1280 && process.env.SCHOOL_REPORT_ARTIFACTS) {
        await mkdir(process.env.SCHOOL_REPORT_ARTIFACTS, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SCHOOL_REPORT_ARTIFACTS, 'overview-test-data.png'), fullPage: true });
      }
      await page.getByRole('button', { name: 'ดูรายงาน', exact: true }).click();
      const dialog = page.getByRole('dialog');
      assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), `dialog overflow at ${width}`);
      if (width === 390 && process.env.SCHOOL_REPORT_ARTIFACTS) {
        await page.screenshot({ path: path.join(process.env.SCHOOL_REPORT_ARTIFACTS, 'mobile-test-data.png'), fullPage: true });
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('printing isolates the report and generates a real PDF without navigation chrome', async () => {
  const { page, context, errors } = await openReport();
  try {
    await page.getByRole('button', { name: 'ดูรายงาน', exact: true }).click();
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('#root').evaluate((el) => getComputedStyle(el).display), 'none');
    assert.equal(await page.locator('.school-report-actions').evaluate((el) => getComputedStyle(el).display), 'none');
    assert.equal(await page.locator('.affiliation-school-report-print').evaluate((el) => getComputedStyle(el).display), 'block');
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    if (process.env.SCHOOL_REPORT_ARTIFACTS) {
      await page.pdf({ path: path.join(process.env.SCHOOL_REPORT_ARTIFACTS, 'school-report-test-data.pdf'), format: 'A4', printBackground: true });
      await page.emulateMedia({ media: 'screen' });
      await page.screenshot({ path: path.join(process.env.SCHOOL_REPORT_ARTIFACTS, 'report-test-data.png'), fullPage: true });
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('pending requests leave summary unknown and prevent premature exports', async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const { page, context } = await openReport(fixture, { onRequest: async (route) => {
    await waiting;
    await route.fulfill({ json: { success: true, data: fixture } });
  }});
  try {
    assert.equal(await page.getByTestId('total-students').textContent(), '–');
    assert.equal(await page.getByRole('button', { name: 'ดูรายงาน', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'ส่งออก Excel', exact: true }).isDisabled(), true);
    release();
    await page.getByRole('heading', { name: 'โรงเรียนทดสอบ ก', exact: true }).waitFor();
    assert.equal(await page.getByTestId('total-students').textContent(), '20');
  } finally { release(); await context.close(); }
});

test('long print reports retain every school rather than clipping at dialog height', async () => {
  const schools = Array.from({ length: 65 }, (_, index) => ({
    id: index + 1, name: `โรงเรียนทดสอบลำดับ ${index + 1}`, student_count: index + 1, vehicle_count: 1,
  }));
  const data = { ...fixture, schools, summary: {
    total_schools: schools.length,
    total_students: schools.reduce((sum, school) => sum + school.student_count, 0), total_vehicles: 1,
  }};
  const { page, context, errors } = await openReport(data);
  try {
    await page.getByRole('button', { name: 'ดูรายงาน', exact: true }).click();
    assert.equal(await page.getByRole('dialog').locator('tbody tr').count(), 65);
    await page.emulateMedia({ media: 'print' });
    const printBox = await page.locator('.affiliation-school-report-print').evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight, height: getComputedStyle(el).height, max: getComputedStyle(el).maxHeight, overflow: getComputedStyle(el).overflow, position: getComputedStyle(el).position }));
    assert.ok(printBox.scroll <= printBox.client);
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    if (process.env.SCHOOL_REPORT_ARTIFACTS) {
      await page.pdf({ path: path.join(process.env.SCHOOL_REPORT_ARTIFACTS, 'long-school-report-test-data.pdf'), format: 'A4', printBackground: true });
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test('browser download round-trips the real backend Excel workbook with Thai school rows', async () => {
  const require = createRequire(import.meta.url);
  const { buildAffiliationSchoolsWorkbook } = require('../../backend/src/utils/affiliationSchoolsWorkbook.js');
  const ExcelJS = require('../../backend/node_modules/exceljs');
  const responseBytes = Buffer.from(await buildAffiliationSchoolsWorkbook(fixture).xlsx.writeBuffer());
  const { page, context, errors } = await openReport(fixture, { onRequest: async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/excel')) {
      await route.fulfill({ contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: responseBytes });
    } else await route.fulfill({ json: { success: true, data: fixture } });
  }});
  try {
    const pendingDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'ส่งออก Excel', exact: true }).click();
    const download = await pendingDownload;
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const sheet = workbook.getWorksheet('สรุปโรงเรียนในสังกัด');
    assert.equal(sheet.getCell('B2').value, 'สังกัดทดสอบ');
    assert.equal(sheet.getCell('B9').value, 'โรงเรียนทดสอบ ก');
    assert.equal(sheet.getCell('C9').value, 12);
    assert.equal(sheet.getCell('D9').value, 3);
    assert.equal(sheet.getCell('B10').value, 'โรงเรียนทดสอบ ข');
    assert.equal(sheet.getCell('C10').value, 8);
    assert.equal(sheet.getCell('D10').value, 2);
    assert.equal(sheet.getCell('C11').value, 20);
    assert.equal(sheet.getCell('D11').value, 4);
    if (process.env.SCHOOL_REPORT_ARTIFACTS) {
      await writeFile(path.join(process.env.SCHOOL_REPORT_ARTIFACTS, 'school-report-test-data.xlsx'), bytes);
    }
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
