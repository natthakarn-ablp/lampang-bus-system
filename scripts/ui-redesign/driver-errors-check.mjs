#!/usr/bin/env node
/**
 * driver-errors-check.mjs — ด่านตรวจการแปลข้อความผิดพลาดฝั่งคนขับ
 *
 * ที่มา: การทดสอบบัญชีคนขับจริงบน production (27 ส.ค. 2569) พบข้อความ
 * ภาษาอังกฤษดิบจาก backend หลุดถึงหน้าจอคนขับสองแบบ
 *   1. "Vehicle not found for this driver account" — บัญชียังไม่ผูกกับรถ
 *   2. "label required" — เว้นช่องชื่อจุดรับส่งไว้
 * ทั้งสองแบบคนขับรถโรงเรียนอ่านไม่ออก
 *
 * ด่านนี้ตรวจ utils/driverErrors.js ซึ่งเป็นตัวกลางที่ทุกหน้าของคนขับใช้
 * ประเด็นที่ต้องไม่พังคือ:
 *   - แยก "บัญชีไม่ผูกรถ" ออกจาก "เน็ตหลุด/เซิร์ฟเวอร์ล่ม" ได้จริง
 *     เพราะสองอย่างนี้ต้องแสดงผลคนละแบบ (ปลดด่านตรวจรถ vs คงด่านไว้)
 *   - ข้อความอังกฤษที่ยังไม่มีคำแปล ต้องไม่หลุดไปถึงผู้ใช้
 *
 * Usage:
 *   node scripts/ui-redesign/driver-errors-check.mjs
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const mod = await import(pathToFileURL(resolve(root, 'frontend/src/utils/driverErrors.js')).href);
const { isDriverNotLinked, driverErrorMessage, driverFieldErrors } = mod;

const err = (status, message, errors) => ({ response: { status, data: { message, errors } } });
const offline = () => new Error('Network Error');

const CASES = [
  // ── การแยกแยะสาเหตุ ────────────────────────────────────────────────
  ['บัญชีไม่ผูกรถ 400 อังกฤษ', () => isDriverNotLinked(err(400, 'Vehicle not found for this driver account')), true],
  ['บัญชีไม่ผูกรถ 409 ไทย', () => isDriverNotLinked(err(409, 'บัญชีนี้ยังไม่เชื่อมกับข้อมูลคนขับ')), true],
  ['เซิร์ฟเวอร์ล่ม 500 ไม่นับ', () => isDriverNotLinked(err(500, 'Internal error')), false],
  ['400 เรื่องอื่นไม่นับ', () => isDriverNotLinked(err(400, 'Something else entirely')), false],
  ['เน็ตหลุดไม่นับ', () => isDriverNotLinked(offline()), false],

  // ── การแปลข้อความ ─────────────────────────────────────────────────
  ['แปลข้อความบัญชีไม่ผูกรถ', () => driverErrorMessage(err(400, 'Vehicle not found for this driver account')), 'บัญชีของคุณยังไม่ได้ผูกกับรถ'],
  ['แปล label required', () => driverErrorMessage(err(400, 'label required')), 'กรุณากรอกชื่อจุดรับส่ง'],
  ['ข้อความไทยผ่านตามเดิม', () => driverErrorMessage(err(400, 'บัญชีนี้ยังไม่เชื่อมกับข้อมูลคนขับ')), 'บัญชีนี้ยังไม่เชื่อมกับข้อมูลคนขับ'],
  ['อังกฤษที่ไม่รู้จักต้องไม่หลุด', () => driverErrorMessage(err(500, 'ECONNREFUSED at pool.query')), 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง'],
  ['403 ได้ข้อความเรื่องสิทธิ์', () => driverErrorMessage(err(403, 'Forbidden')), 'บัญชีของคุณไม่มีสิทธิ์ใช้งานส่วนนี้'],
  ['เน็ตหลุดได้ข้อความเรื่องสัญญาณ', () => driverErrorMessage(offline()), 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบสัญญาณอินเทอร์เน็ต'],

  // ── ข้อผิดพลาดรายช่อง ─────────────────────────────────────────────
  ['errors array แปลเป็นไทย', () => driverFieldErrors(err(400, null, [{ field: 'label', message: 'label required' }]))[0].message, 'กรุณากรอกชื่อจุดรับส่ง'],
  ['errors array คงชื่อ field ไว้', () => driverFieldErrors(err(400, null, [{ field: 'label', message: 'label required' }]))[0].field, 'label'],
  ['ไม่มี errors array ใช้ข้อความเดี่ยว', () => driverFieldErrors(err(400, 'Vehicle not found for this driver account'))[0].message, 'บัญชีของคุณยังไม่ได้ผูกกับรถ'],
];

let pass = 0;
const failures = [];
for (const [name, fn, want] of CASES) {
  let got;
  try { got = fn(); } catch (e) { got = `โยน error: ${e.message}`; }
  if (got === want) pass++;
  else failures.push({ name, got, want });
}

for (const [name] of CASES) {
  if (!failures.some(f => f.name === name)) console.log(`  ✓ ${name}`);
}
for (const f of failures) {
  console.log(`  ✗ ${f.name}`);
  console.log(`      ได้:     ${JSON.stringify(f.got)}`);
  console.log(`      ควรได้: ${JSON.stringify(f.want)}`);
}

console.log(`\n  ผ่าน ${pass}/${CASES.length}`);
if (failures.length) {
  console.log('\n  ✗ FAIL — ข้อความผิดพลาดฝั่งคนขับแปลไม่ถูกต้อง');
  process.exit(1);
}
console.log('  ✓ PASS');
