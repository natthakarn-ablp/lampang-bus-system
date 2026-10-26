#!/usr/bin/env node
/**
 * check-live-pages.mjs — เปิดหน้าสาธารณะของเว็บจริงด้วยเบราว์เซอร์ แล้วรายงาน error
 *
 * ทำไมต้องมี
 * ----------
 * `production-readiness-gate.sh public` ตรวจว่า HTTP ตอบ 200 ซึ่งผ่านได้แม้หน้าจะพัง
 * เพราะแอปเป็น SPA — เซิร์ฟเวอร์ส่ง index.html สำเร็จเสมอ ส่วนหน้าจะขึ้นหรือจะล้ม
 * เกิดขึ้นในเบราว์เซอร์หลังจากนั้น สคริปต์นี้จึงเปิดหน้าจริงและฟังสิ่งที่ gate มองไม่เห็น
 * คือ error ในคอนโซล ข้อผิดพลาดของสคริปต์ คำขอที่ล้มเหลว และหน้าที่ตกลง ErrorBoundary
 *
 * เรื่องจริงที่สคริปต์นี้จับได้ในการรันครั้งแรก (8 ก.ย. 2569) คือ Cloudflare แทรกสคริปต์
 * เก็บสถิติเข้าทุกหน้า แล้วถูก CSP ของเราบล็อก เกิด error ทุกครั้งที่ผู้ใช้เปิดหน้า
 * โดยไม่มีใครรู้ เพราะไม่มีอะไรเฝ้าคอนโซลของผู้ใช้จริง (ดู RR-11)
 *
 * ความปลอดภัย
 * -----------
 * อ่านอย่างเดียวทั้งหมด ไม่เข้าสู่ระบบ ไม่กรอกฟอร์ม ไม่กดปุ่มใด ไม่แตะฐานข้อมูล
 * และเปิดเฉพาะหน้าที่เปิดสาธารณะอยู่แล้ว จึงรันกับ production ได้โดยไม่ต้องขออนุมัติ
 *
 * วิธีใช้
 *   node scripts/check-live-pages.mjs
 *   node scripts/check-live-pages.mjs --base https://schoolbuslampang.com
 *   node scripts/check-live-pages.mjs --json
 *
 * exit code: 0 = ไม่พบปัญหา · 1 = พบ error หรือหน้าไม่ขึ้น
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(resolve(here, '..', 'frontend', 'package.json'));
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const bi = argv.indexOf('--base');
const BASE = bi >= 0 ? argv[bi + 1] : 'https://schoolbuslampang.com';
const JSON_MODE = argv.includes('--json');

/**
 * เฉพาะหน้าที่ไม่ต้องเข้าสู่ระบบ หน้าอื่นต้องใช้บัญชีจริงซึ่งสคริปต์นี้ตั้งใจไม่แตะ
 * ถ้าเพิ่มหน้าใหม่ที่เปิดสาธารณะ ให้เพิ่มที่นี่ด้วย
 */
const PAGES = [
  { name: 'หน้าเข้าสู่ระบบ', path: '/' },
  { name: 'สารบัญคู่มือ', path: '/manual/' },
  { name: 'คู่มือคนขับ', path: '/manual/user-guide-driver.html' },
  { name: 'คู่มือโรงเรียน', path: '/manual/user-guide-school.html' },
  { name: 'คู่มือจังหวัด', path: '/manual/user-guide-province.html' },
  { name: 'หน้าผูกบัญชีผู้ปกครอง', path: '/parent/link' },
  { name: 'หน้ากู้รหัสผ่านผู้ดูแลระบบ', path: '/parent/link/admin-recovery' },
];

/**
 * error ที่ต้นเหตุอยู่นอกโค้ดของเรา และเรารู้อยู่แล้ว ยังรายงานอยู่แต่แยกออกจาก
 * ของเรา เพื่อไม่ให้เสียงรบกวนกลบ error จริง และเพื่อไม่ให้ใครปิดปัญหาด้วยการ
 * เพิกเฉยทั้งกอง แต่ละรายการต้องมีเลขทะเบียนความเสี่ยงกำกับเสมอ
 */
const KNOWN_EXTERNAL = [
  { match: /cloudflareinsights\.com/, ref: 'RR-11', note: 'Cloudflare แทรกสคริปต์เก็บสถิติ แล้วถูก CSP ของเราบล็อก' },
];

function classify(text) {
  return KNOWN_EXTERNAL.find((k) => k.match.test(text)) || null;
}

async function checkPage(browser, page) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const tab = await ctx.newPage();
  const ours = [];
  const external = [];
  const failed = [];

  const record = (text) => {
    const known = classify(text);
    if (known) external.push({ text: text.slice(0, 240), ref: known.ref, note: known.note });
    else ours.push(text.slice(0, 240));
  };

  tab.on('console', (m) => { if (m.type() === 'error') record(m.text()); });
  tab.on('pageerror', (e) => record('pageerror: ' + String(e.message)));
  tab.on('requestfailed', (r) => {
    const line = `${r.method()} ${r.url()} — ${r.failure()?.errorText || 'failed'}`;
    if (!classify(line)) failed.push(line.slice(0, 240));
  });

  let status = null;
  try {
    const resp = await tab.goto(BASE + page.path, { waitUntil: 'networkidle', timeout: 45000 });
    status = resp ? resp.status() : null;
    await tab.waitForTimeout(1500);
  } catch (e) {
    ours.push('navigation: ' + String(e.message).slice(0, 200));
  }

  // หน้าที่ตกลง ErrorBoundary ยังตอบ 200 เสมอ จึงต้องดูข้อความในหน้า ไม่ใช่ status
  const crashed = await tab
    .evaluate(() => !!document.body && /เกิดข้อผิดพลาด|Something went wrong|ErrorBoundary/i.test(document.body.innerText))
    .catch(() => false);
  const chars = await tab.evaluate(() => (document.body ? document.body.innerText.length : 0)).catch(() => 0);
  const title = await tab.title().catch(() => '');

  await ctx.close();
  return { ...page, status, title, chars, crashed, ours, external, failed };
}

const browser = await chromium.launch();
const results = [];
for (const p of PAGES) results.push(await checkPage(browser, p));
await browser.close();

const broken = results.filter((r) => r.crashed || r.ours.length || r.failed.length || r.status !== 200);

if (JSON_MODE) {
  console.log(JSON.stringify({ base: BASE, checked: results.length, broken: broken.length, results }, null, 2));
} else {
  console.log(`[live-pages] ${BASE}`);
  for (const r of results) {
    const flag = r.crashed ? 'CRASH' : r.ours.length || r.failed.length ? 'ERR ' : r.status !== 200 ? 'HTTP' : ' ok ';
    console.log(`  [${flag}] ${String(r.status).padEnd(3)} ${r.name}  (${r.chars} ตัวอักษร)`);
    for (const e of r.ours) console.log(`          ปัญหาของเรา: ${e}`);
    for (const f of r.failed) console.log(`          คำขอล้มเหลว: ${f}`);
    for (const e of r.external) console.log(`          ภายนอก (${e.ref}): ${e.note}`);
  }
  console.log(`\nตรวจ ${results.length} หน้า · ต้องแก้ ${broken.length} หน้า`);
}

process.exit(broken.length ? 1 : 0);
