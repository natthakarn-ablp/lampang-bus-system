#!/usr/bin/env node
/**
 * manual-screenshots.mjs — ถ่ายภาพประกอบคู่มืออบรมใหม่ให้ตรงกับ UI ปัจจุบัน
 *
 * ที่มา: ภาพใน docs/manual-html/screenshots/ ถ่ายไว้ตั้งแต่ 27 มิ.ย. 2569
 * ซึ่งเป็น UI ก่อนการรีดีไซน์ทั้งระบบ ครูที่เปิดคู่มือจึงเห็นหน้าจอที่ไม่มี
 * อยู่จริงแล้ว — เช่นเมนูล่างของคนขับที่เขียน "คำขอ" ทั้งที่ระบบจริงเป็น
 * "ขึ้นทะเบียน" และบางภาพถ่ายตอนหน้ายังโหลดไม่เสร็จจนอ่านข้อความไม่ออก
 *
 * ใช้ fixtures ชุดเดียวกับ capture.mjs ทั้งหมด แปลว่า:
 *   - ไม่มีการเรียก API จริง ทุก /api/** ถูกดักไว้ก่อนออกจากเบราว์เซอร์
 *   - ข้อมูลในภาพเป็นข้อมูลสังเคราะห์ ไม่ใช่ชื่อนักเรียนหรือเบอร์ผู้ปกครองจริง
 *     (ข้อกำหนด PDPA — คู่มือถูกแจกจ่ายให้ครูทั้งจังหวัด)
 *
 * Usage:
 *   cd frontend && npx vite --port 5173      # terminal 1
 *   node scripts/ui-redesign/manual-screenshots.mjs             # ถ่ายทั้งหมด
 *   node scripts/ui-redesign/manual-screenshots.mjs --only driver
 *   node scripts/ui-redesign/manual-screenshots.mjs --dry-run   # ดูรายการเฉย ๆ
 */

import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { USERS, newPage, BASE } from './capture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const { chromium } = createRequire(resolve(root, 'frontend/package.json'))('playwright');

const OUT = resolve(root, 'docs/manual-html/screenshots');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i === -1 ? null : process.argv[i + 1]; })();
const DRY = process.argv.includes('--dry-run');

/* ขนาดต้องตรงกับภาพเดิม ไม่งั้น layout ของคู่มือขยับ
   เดสก์ท็อป 1440x900 @2x = 2880x1800 · มือถือ 390x844 @2x = 780x1688 */
const DESKTOP = { viewport: { width: 1440, height: 900 }, scale: 2 };
const MOBILE = { viewport: { width: 390, height: 844 }, scale: 2 };

/** เปิดโมดัล/แผงที่ภาพนั้นต้องการ ก่อนกดชัตเตอร์ */
const act = {
  async click(page, sel, waitMs = 700) {
    const el = page.locator(sel).first();
    if (await el.count()) { await el.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(waitMs); }
  },
  async tab(page, name) { await act.click(page, `button:has-text("${name}")`); },
};

/** ผ่านด่านตรวจสภาพรถ เพื่อถ่ายหน้าที่อยู่ข้างหลังโมดัลนั้น
 *
 *  การกดปุ่มทำให้ toast "บันทึกผลตรวจรถสำเร็จ" เด้งทับหน้าจอ ซึ่งไม่ใช่
 *  สภาพปกติของหน้าที่ครูจะเห็นตอนใช้งาน จึงลบทิ้งก่อนกดชัตเตอร์
 *  (รอให้หายเองกินเวลาหลายวินาทีต่อภาพ) */
async function passPretrip(page) {
  await act.click(page, 'button:has-text("ทุกรายการปกติ")', 1200);
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[role="status"], [role="alert"], .toast, [data-sonner-toast]')) {
      el.remove();
    }
  }).catch(() => {});
  await page.waitForTimeout(200);
}

/* ── ภาพที่ต้องถ่าย: ชื่อไฟล์ในคู่มือ -> หน้าจริง ────────────────────────
   id ต้องตรงกับ path เดิมเป๊ะ เพราะคู่มือ HTML และ markdown อ้างชื่อนี้ */
const SHOTS = [
  // ── shared ──
  { id: 'shared/00-login-desktop', url: '/login', user: null, ...DESKTOP },
  { id: 'shared/00-login-mobile', url: '/login', user: null, ...MOBILE },
  { id: 'shared/01-change-password', url: '/change-password', user: 'school', ...DESKTOP },
  { id: 'shared/reports-daily', url: '/reports/daily', user: 'admin', ...DESKTOP },

  // ── admin ──
  { id: 'admin/01-dashboard', url: '/admin', user: 'admin', ...DESKTOP },
  { id: 'admin/02-users', url: '/admin/users', user: 'admin', ...DESKTOP },
  { id: 'admin/03-transfer-requests', url: '/admin/transfer-requests', user: 'admin', ...DESKTOP },
  { id: 'admin/04-vehicle-requests', url: '/admin/vehicle-requests', user: 'admin', ...DESKTOP },
  { id: 'admin/05-driver-integrity', url: '/admin/driver-integrity', user: 'admin', ...DESKTOP },
  { id: 'admin/06-pickup-points', url: '/admin/pickup-points', user: 'admin', ...DESKTOP },
  { id: 'admin/07-live-vehicles', url: '/admin/live-vehicles', user: 'admin', ...DESKTOP },
  { id: 'admin/08-readiness', url: '/admin/readiness', user: 'admin', ...DESKTOP },
  { id: 'admin/09-audit-logs', url: '/admin/audit-logs', user: 'admin', ...DESKTOP },
  { id: 'admin/10-system-health', url: '/admin/system-health', user: 'admin', ...DESKTOP },
  { id: 'admin/11-measurement', url: '/admin/measurement', user: 'admin', ...DESKTOP },
  { id: 'admin/12-research', url: '/admin/research', user: 'admin', ...DESKTOP },
  { id: 'admin/13-research-export', url: '/admin/research-export', user: 'admin', ...DESKTOP },
  { id: 'admin/14-evaluation', url: '/admin/evaluation', user: 'admin', ...DESKTOP },
  { id: 'admin/14-scope', url: '/admin/scope', user: 'admin', ...DESKTOP },
  { id: 'admin/15-executive', url: '/admin/executive-print', user: 'admin', ...DESKTOP },

  // ── province ──
  { id: 'province/01-dashboard', url: '/province', user: 'province', ...DESKTOP },
  { id: 'province/02-affiliations', url: '/province/affiliations', user: 'province', ...DESKTOP },
  { id: 'province/03-schools', url: '/province/schools', user: 'province', ...DESKTOP },
  { id: 'province/04-students', url: '/province/students', user: 'province', ...DESKTOP },
  { id: 'province/05-vehicles', url: '/province/vehicles', user: 'province', ...DESKTOP },
  { id: 'province/06-status', url: '/province/status', user: 'province', ...DESKTOP },
  { id: 'province/07-live-vehicles', url: '/province/live-vehicles', user: 'province', ...DESKTOP },
  { id: 'province/08-pickup-map', url: '/province/pickup-map', user: 'province', ...DESKTOP },
  { id: 'province/09-readiness', url: '/province/readiness', user: 'province', ...DESKTOP },
  { id: 'province/10-emergencies', url: '/province/emergencies', user: 'province', ...DESKTOP },
  { id: 'province/11-audit-log', url: '/province/audit-log', user: 'province', ...DESKTOP },

  // ── affiliation ──
  { id: 'affiliation/01-dashboard', url: '/affiliation', user: 'affiliation', ...DESKTOP },
  { id: 'affiliation/02-schools', url: '/affiliation/schools', user: 'affiliation', ...DESKTOP },
  { id: 'affiliation/03-students', url: '/affiliation/students', user: 'affiliation', ...DESKTOP },
  { id: 'affiliation/04-vehicles', url: '/affiliation/vehicles', user: 'affiliation', ...DESKTOP },
  { id: 'affiliation/05-accounts', url: '/affiliation/accounts', user: 'affiliation', ...DESKTOP },
  { id: 'affiliation/06-status', url: '/affiliation/status', user: 'affiliation', ...DESKTOP },
  { id: 'affiliation/07-live-vehicles', url: '/affiliation/live-vehicles', user: 'affiliation', ...DESKTOP },
  { id: 'affiliation/08-pickup-map', url: '/affiliation/pickup-map', user: 'affiliation', ...DESKTOP },
  { id: 'affiliation/09-emergencies', url: '/affiliation/emergencies', user: 'affiliation', ...DESKTOP },
  { id: 'affiliation/10-audit-log', url: '/affiliation/audit-log', user: 'affiliation', ...DESKTOP },

  // ── school ──
  { id: 'school/01-dashboard', url: '/school', user: 'school', ...DESKTOP },
  { id: 'school/02-students', url: '/school/students', user: 'school', ...DESKTOP },
  { id: 'school/03-vehicles', url: '/school/vehicles', user: 'school', ...DESKTOP },
  { id: 'school/04-vehicle-verification', url: '/school/vehicle-verification', user: 'school', ...DESKTOP },
  { id: 'school/05-bulk-vehicles', url: '/school/bulk-vehicles', user: 'school', ...DESKTOP },
  { id: 'school/06-pickup-map', url: '/school/pickup-map', user: 'school', ...DESKTOP },
  { id: 'school/07-live-vehicles', url: '/school/live-vehicles', user: 'school', ...DESKTOP },
  { id: 'school/08-approvals', url: '/school/approvals', user: 'school', ...DESKTOP },
  { id: 'school/09-teacher-accounts', url: '/school/teacher-accounts', user: 'school', ...DESKTOP },
  { id: 'school/10-emergencies', url: '/school/emergencies', user: 'school', ...DESKTOP },
  { id: 'school/11-audit-log', url: '/school/audit-log', user: 'school', ...DESKTOP },
  { id: 'school/12-reports-daily', url: '/reports/daily', user: 'school', ...DESKTOP },
  { id: 'school/13-reports-monthly', url: '/reports/monthly', user: 'school', ...DESKTOP },
  { id: 'school/14-reports-summary', url: '/reports/summary', user: 'school', ...DESKTOP },
  { id: 'school/18-registration-review', url: '/school/registration-review', user: 'school', ...DESKTOP },
  // โมดัลบนหน้ารายชื่อนักเรียน — ต้องกดเปิดก่อนถึงจะเห็น
  { id: 'school/04-import-preview', url: '/school/students', user: 'school', ...DESKTOP,
    act: async (p) => { await act.click(p, 'button:has-text("นำเข้า")', 900); } },
  { id: 'school/05-import-history', url: '/school/students', user: 'school', ...DESKTOP,
    act: async (p) => { await act.click(p, 'button:has-text("ประวัติการนำเข้า")', 900); } },
  // โมดัลโอนย้ายอยู่ "หลัง" โมดัลแก้ไขนักเรียน (StudentSearch.jsx:510) ต้องกด
  // แก้ไขของแถวแรกก่อน แล้วจึงกด "ขอโอนย้ายนักเรียน" — selector เดิมหาไม่เจอ
  { id: 'school/17-transfer', url: '/school/students', user: 'school', ...DESKTOP,
    act: async (p) => {
      await act.click(p, 'button:has-text("แก้ไข")', 900);
      await act.click(p, 'button:has-text("ขอโอนย้ายนักเรียน")', 900);
    } },

  // ── transport ──
  { id: 'transport/01-dashboard', url: '/transport', user: 'transport', ...DESKTOP },
  { id: 'transport/02-verification', url: '/transport/verification', user: 'transport', ...DESKTOP },
  { id: 'transport/03-inspections', url: '/transport/inspections', user: 'transport', ...DESKTOP },
  { id: 'transport/04-pickup-map', url: '/transport/pickup-map', user: 'transport', ...DESKTOP },

  // ── driver (มือถือ) ──
  // ชื่อไฟล์ต้องตรงกับที่คู่มืออ้าง ไม่ใช่ลำดับหน้าในเมนู — เลข 04/05/06
  // ของคนขับเรียงเป็น แผนที่ / ฉุกเฉิน / โปรไฟล์ ตามคู่มือฉบับเดิม
  { id: 'driver/01-dashboard', url: '/driver', user: 'driver', ...MOBILE },
  { id: 'driver/02-pretrip', url: '/driver/pretrip', user: 'driver', ...MOBILE },
  { id: 'driver/03-requests', url: '/driver/requests', user: 'driver', ...MOBILE },
  { id: 'driver/04-pickup-map', url: '/driver/pickup-map', user: 'driver', ...MOBILE },
  { id: 'driver/05-emergency', url: '/driver/emergency', user: 'driver', ...MOBILE },
  { id: 'driver/06-profile', url: '/driver/profile', user: 'driver', ...MOBILE },
  // หน้าเช็กชื่ออยู่หลังด่านตรวจสภาพรถ ซึ่งเป็นโมดัลที่ปิดไม่ได้ —
  // ต้องตอบแบบสอบถามให้ผ่านก่อน ไม่งั้นได้ภาพโมดัลซ้ำกับ 01-dashboard
  { id: 'driver/01c-checkin-top', url: '/driver', user: 'driver', ...MOBILE, act: passPretrip },
  // รายชื่อรายคนซ่อนอยู่หลังปุ่ม "มีข้อยกเว้น" — ค่าเริ่มต้นของหน้าคือปุ่มเดียว
  // ที่เช็กครบทุกคนรวดเดียว ซึ่งเป็นทางที่คนขับใช้บ่อยที่สุด
  { id: 'driver/15-roster', url: '/driver', user: 'driver', ...MOBILE,
    act: async (p) => { await passPretrip(p); await act.click(p, 'button:has-text("มีข้อยกเว้น")', 900); } },
  // ภาพนี้ต้องต่างจาก 15-roster: เลื่อนอย่างเดียวได้ภาพเดียวกันทุกพิกเซล
  // จึงกดสถานะของเด็กคนแรกให้เห็นผลการเลือกจริงบนรายชื่อ
  { id: 'driver/15b-roster-form', url: '/driver', user: 'driver', ...MOBILE,
    act: async (p) => {
      await passPretrip(p);
      await act.click(p, 'button:has-text("มีข้อยกเว้น")', 900);
      // ปุ่มรายคนเปลี่ยนตามรอบ: รอบเช้าเป็น "ขึ้นรถ" รอบเย็นเป็น "รับกลับบ้าน"
      // (DriverDashboard.jsx) — selector ที่จับได้ทั้งสองรอบเท่านั้นที่ทำให้
      // ภาพนี้ต่างจาก 15-roster จริง
      const first = p.locator('button:has-text("ขึ้นรถ"), button:has-text("รับกลับบ้าน")').first();
      if (await first.count()) {
        await first.scrollIntoViewIfNeeded().catch(() => {});
        await first.click({ timeout: 4000 }).catch(() => {});
        await p.waitForTimeout(900);
      }
    } },

  // ── เมนูบัญชีผู้ใช้ (ต้องกดเปิด) ──
  { id: 'shared/account-menu', url: '/school', user: 'school', ...DESKTOP,
    act: async (p) => { await act.click(p, 'button[aria-haspopup="menu"]', 600); } },

  // ── โมดัลของโรงเรียนที่คู่มืออ้างถึง ──
  // ปุ่มบนหน้าจริงเขียนว่า "แบบเดิม" (คำเต็ม "นำเข้าแบบเดิม (สำรอง)" อยู่ใน title
  // ซึ่ง has-text ไม่เห็น) — selector เดิมจึงไม่กดอะไรเลย ได้ภาพซ้ำหน้ารายชื่อ
  { id: 'school/06-import-legacy', url: '/school/students', user: 'school', ...DESKTOP,
    act: async (p) => { await act.click(p, 'button:has-text("แบบเดิม")', 900); } },
  { id: 'school/13-override', url: '/school', user: 'school', ...DESKTOP,
    act: async (p) => { await act.click(p, 'button:has-text("ยืนยันแทนคนขับ")', 900); } },

  // ── parent ──
  // parent/01-status ถ่ายไม่ได้: /parent ปฏิเสธการทำงานนอก LINE client โดยตั้งใจ
  // (ยืนยันตัวตนจาก id_token ที่ LINE เซ็นเท่านั้น) การทำให้ถ่ายได้ต้องเปิดช่อง
  // ระบุตัวตนผ่าน query param ซึ่งเป็นช่องโหว่ — ภาพนั้นต้องถ่ายด้วยคนใน LINE
  { id: 'parent/02-link', url: '/parent/link', user: null, ...MOBILE },
];

const wanted = ONLY ? SHOTS.filter(s => s.id.startsWith(ONLY)) : SHOTS;

if (DRY) {
  console.log(`จะถ่าย ${wanted.length} ภาพ:`);
  for (const s of wanted) console.log(`  ${s.id.padEnd(38)} ${s.url}  [${s.user || 'ไม่ล็อกอิน'}]`);
  process.exit(0);
}

const browser = await chromium.launch();
let ok = 0; const failed = [];
/* endpoint ที่หน้าเรียกแต่ไม่มี fixture จะได้ {} กลับไป ทำให้ภาพในคู่มือขึ้น
   ศูนย์หรือตารางว่าง ซึ่งไม่ได้สอนอะไรครูเลย — เก็บรายชื่อไว้รายงานท้ายสุด */
const missingFixtures = new Map();

for (const shot of wanted) {
  const dir = join(OUT, dirname(shot.id));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const { ctx, page, errors } = await newPage(
    browser,
    shot.user ? USERS[shot.user] : null,
    { ...shot.viewport, deviceScaleFactor: shot.scale },
    'normal',
  );

  // คำตอบที่ data ว่างเปล่า = ไม่มี fixture สำหรับ endpoint นั้น ภาพจะขึ้นศูนย์
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (!u.pathname.startsWith('/api/')) return;
    try {
      const d = (await res.json())?.data;
      const empty = d == null
        || (Array.isArray(d) && d.length === 0)
        || (typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length === 0);
      if (empty) {
        if (!missingFixtures.has(u.pathname)) missingFixtures.set(u.pathname, new Set());
        missingFixtures.get(u.pathname).add(shot.id);
      }
    } catch { /* ไม่ใช่ JSON */ }
  });

  try {
    await page.goto(BASE + shot.url, { waitUntil: 'networkidle', timeout: 20000 });
    // หน้าโหลดข้อมูลผ่าน effect หลัง networkidle — รอจน skeleton หายไป
    // ภาพเดิมบางใบถ่ายเร็วเกินจนได้ placeholder เบลอแทนข้อความจริง
    await page.waitForTimeout(1200);
    await page.waitForFunction(
      () => !document.querySelector('.animate-pulse, [data-loading="true"]'),
      { timeout: 5000 },
    ).catch(() => {});
    if (shot.act) await shot.act(page);
    // ด่านกันภาพเสีย: ถ้าหน้าตกไปที่ ErrorBoundary ภาพจะเป็นจอ "เกิดข้อผิดพลาด"
    // ซึ่งเคยหลุดเข้าคู่มือถึง 5 ใบ เพราะสคริปต์ถือว่า "ถ่ายได้" = สำเร็จ
    const crashed = await page.locator('text=ระบบพบปัญหาที่ไม่คาดคิด').count();
    if (crashed) throw new Error('ErrorBoundary: หน้าล้มเหลว (fixture ไม่ตรง shape ของ API?)');
    await page.screenshot({ path: join(OUT, `${shot.id}.png`) });
    ok++;
    const note = errors.length ? `  (console ${errors.length})` : '';
    console.log(`  ✓ ${shot.id}${note}`);
  } catch (e) {
    failed.push({ id: shot.id, why: e.message.split('\n')[0].slice(0, 80) });
    console.log(`  ✗ ${shot.id} — ${e.message.split('\n')[0].slice(0, 60)}`);
  } finally {
    await ctx.close();
  }
}

await browser.close();

console.log(`\n  ถ่ายสำเร็จ ${ok}/${wanted.length}`);
if (failed.length) {
  console.log('  ล้มเหลว:');
  for (const f of failed) console.log(`    ${f.id} — ${f.why}`);
  process.exitCode = 1;
}

// ด่านกันภาพซ้ำ: ภาพสองใบที่ไบต์ตรงกันแปลว่า act ไม่ได้เปิดโมดัล/โหมดที่ตั้งใจ
// (เคยเกิดกับ school/06-import-legacy, school/17-transfer, driver/15b-roster-form
//  เพราะข้อความบนปุ่มเปลี่ยนไป selector เดิมจึงไม่กดอะไรเลย)
{
  const { createHash } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const byHash = new Map();
  for (const shot of wanted) {
    let buf;
    try { buf = readFileSync(join(OUT, `${shot.id}.png`)); } catch { continue; }
    const h = createHash('sha256').update(buf).digest('hex');
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(shot.id);
  }
  const dups = [...byHash.values()].filter(ids => ids.length > 1);
  if (dups.length) {
    console.log('');
    console.log('  ภาพซ้ำ (ไบต์ตรงกัน) — act ไม่ได้เปิดสิ่งที่ตั้งใจ:');
    for (const ids of dups) console.log(`    ${ids.join(' = ')}`);
    process.exitCode = 1;
  }
}

if (missingFixtures.size) {
  console.log(`\n  endpoint ที่ยังไม่มี fixture (${missingFixtures.size}) — ภาพจะขึ้นศูนย์หรือตารางว่าง:`);
  for (const [ep, ids] of [...missingFixtures].sort()) {
    const list = [...ids].slice(0, 3).join(', ');
    const more = ids.size > 3 ? ` +${ids.size - 3}` : '';
    console.log(`    ${ep.padEnd(44)} ${list}${more}`);
  }
}
