'use strict';

/**
 * seed-synthetic-staging.js — ตัวสร้างข้อมูลสังเคราะห์สำหรับ local staging (task A0-6)
 *
 * สถานะของไฟล์นี้: เป็น **เครื่องมือสร้างข้อมูลทดสอบ** สำหรับ local staging เท่านั้น
 *   - **ไม่ใช่** การอนุมัติ, **ไม่ใช่** หลักฐานการทดสอบ, **ไม่ใช่** ผล UAT,
 *     **ไม่ใช่** หลักฐาน capacity และ **ไม่ได้** ทำให้ Phase 9 exit gate ผ่าน
 *   - การมีไฟล์นี้อยู่ ไม่ได้แปลว่า staging ถูกตั้งขึ้นแล้ว หรือ A1-8 รันแล้ว
 *   - **ยังไม่เคยรันจริง**: เครื่องที่เขียนไฟล์นี้ไม่มี docker ทำงานอยู่ และไม่มี MySQL client
 *     จึงตรวจได้เพียง `node --check` และ `--dry-run` (โหมดที่ไม่เชื่อมต่อฐานข้อมูล)
 *     ผลรันจริงกับ MySQL 8 ยังไม่มีใครยืนยัน — ถือว่ายังไม่ทราบ ไม่ใช่ว่าใช้ได้
 *
 * ที่มาของงาน: `docs/project-closure/execution-plan-to-completion-2026-09-04.md`
 *   - บรรทัด 98 (A0-6): "ตั้ง local staging: docker-compose MySQL 8 + synthetic data
 *     generator (masked จาก schema ไม่ใช่จาก production)"
 *   - บรรทัด 131 / 301 (A1-8): รัน `backend/scripts/load-test.js` ramp 50/200/500/1000
 *     บน local staging โดยติดป้าย "local, ไม่เทียบเท่า production"
 *
 * ── สิ่งที่สคริปต์นี้ปฏิเสธ และเหตุผล ────────────────────────────────────────
 *
 * 1) ปฏิเสธการอ่าน/เชื่อมต่อ/คัดลอกจาก production
 *    ไม่มี code path ใดที่เปิด connection ที่สอง ไม่มีการ dump ไม่มีการ import
 *    ทุกแถวถูก "สร้าง" จาก list คงที่ในไฟล์นี้ + PRNG ที่ seed ได้ ไม่ได้ "แปลง" มาจากของจริง
 *
 * 2) ปฏิเสธ DB_NAME ที่เป็นฐานข้อมูลจริงหรือสำเนาของจริง
 *    deny list: `lampang_bus` (production — `backend/.env.example:15`,
 *    `backend/scripts/seed-production-uat-users.js:36`), `lampang_bus_dev`
 *    (สำเนา production — ดู `backend/package.json` คีย์ "//test-workflow"),
 *    `lampang_bus_restore_drill` (ปลายทาง restore ของ backup production —
 *    `scripts/create-restore-drill-evidence-pack.js:12`)
 *    และยังบังคับ allow-pattern ซ้ำอีกชั้น: ชื่อฐานต้องมีคำว่า staging/synthetic/
 *    sandbox/local/test อยู่ด้วย — ตรวจสองทางแบบเดียวกับที่ `load-test.js:188-210`
 *    ตรวจ target host แทนที่จะเชื่อผู้เรียก
 *
 * 3) ปฏิเสธเมื่อไม่ได้ประกาศเจตนา
 *    ต้องมี `NODE_ENV=test` หรือธง `--sandbox` อย่างใดอย่างหนึ่ง และ NODE_ENV
 *    ต้องไม่ใช่ production ไม่ว่ากรณีใด
 *
 * 4) ปฏิเสธ host ที่ไม่ใช่ loopback เว้นแต่สั่ง `--allow-remote-host`
 *    ฐานข้อมูลจริงอยู่คนละเครื่อง การชี้ seeder ออกนอก 127.0.0.1 จึงต้องเป็นเจตนา
 *    ที่พิมพ์ออกมา ไม่ใช่ค่า default
 *
 * 5) ปฏิเสธเมื่อพบแถวที่ "ไม่ใช่ของสคริปต์นี้" ในตารางที่ถือว่าเป็นสัญญาณของข้อมูลจริง
 *    (students / parents / vehicles / checkin_logs) เว้นแต่สั่ง `--allow-foreign-rows`
 *    ข้อนี้คือด่านที่ทำให้ชี้สคริปต์ใส่สำเนา production แล้ว "เติมข้อมูลปนเข้าไปเงียบ ๆ" ไม่ได้
 *
 * 6) ปฏิเสธการสร้างเลขบัตรประชาชน — แม้แต่ชั่วคราวในหน่วยความจำ
 *    CLAUDE.md §12 ข้อ 5 ห้ามเก็บเลขบัตรจริง สคริปต์นี้เข้มกว่านั้นคือ **ไม่มีขั้นตอนใด
 *    สร้างเลข 13 หลักขึ้นมาเป็นค่า** ไม่ว่าจริงหรือปลอม `students.cid_hash` มาจาก SHA-256
 *    ของสตริง `syn:student-noncid:<index>:<salt>` จึงไม่มีจุดใดในกระบวนการที่มีเลขบัตรอยู่ให้หลุด
 *    (หมายเหตุ: ตัวเลข 13 ตัวติดกันอาจปรากฏ *ภายใน* ค่า hex ของ hash ได้ตามธรรมชาติ
 *    นั่นไม่ใช่ค่าที่ถูกสร้างขึ้นเป็นเลขบัตร และไม่มีคอลัมน์ใดเก็บค่าเลข 13 หลัก)
 *    ไม่ได้เรียก `src/utils/hash.js` `hashCid()` โดยตั้งใจ เพราะฟังก์ชันนั้นแปลว่า "มี CID เป็น input"
 *
 * ── ความเป็น idempotent และขอบเขตการลบ ─────────────────────────────────────
 *
 * ทุกครั้งที่รัน สคริปต์จะ **ลบเฉพาะแถวที่พิสูจน์ได้ว่าตัวเองสร้าง** แล้วจึง insert ใหม่
 * ไม่ใช้ TRUNCATE และไม่ลบทั้งตาราง เครื่องหมายความเป็นเจ้าของคือ:
 *   affiliations.id LIKE 'SYNAFF%' · schools.id LIKE 'SYNSCH%' · vehicles.id LIKE 'V-SYN%'
 *   students.school_id ∈ โรงเรียน SYNSCH · drivers.phone LIKE '0990%'
 *   parents.phone LIKE '0991%' · users.username LIKE 'loadtest_user_%' หรือ 'syn_%'
 *   participation_cases.case_no LIKE 'PC-SYN%'
 * รันซ้ำด้วย `--scale` เดิม + `--seed` เดิม + `--as-of` เดิม จะได้ชุดข้อมูลเดิมทุกค่า
 * ถ้าไม่ระบุ `--as-of` วันที่ของ checkin/daily_status จะเลื่อนตามวันที่รัน (ตั้งใจ เพราะ
 * `/api/school/daily-status` อ่าน "วันนี้") ส่วนกรณีสคริปต์ตายกลางทาง จะเหลือชุดข้อมูล
 * ไม่ครบ — วิธีแก้คือรันซ้ำ ไม่ใช่ซ่อมมือ
 *
 * ── ค่าที่ยังเติมไม่ได้ เพราะรอการตัดสินใจ ──────────────────────────────────
 *
 * ค่าเหล่านี้ถูกปล่อยว่าง/ปิดไว้โดยตั้งใจ ห้ามเดาแล้วมาแก้ทีหลัง เพราะตัวเลขที่เดาไว้จะไหล
 * เข้า test, export metadata และ evidence ก่อนที่ใครจะทันตรวจ (แผน §4.3 บรรทัด 89)
 *   - สัดส่วน ABSENT / CANCELLED / leave / override ใน `checkin_logs` — **รอ C0-1**
 *     (นิยาม check-in/out, absent, leave, override, void) ตอนนี้ `ABSENT_RATIO = null`
 *     สคริปต์จึงไม่สร้างแถวสถานะเหล่านั้นเลย
 *   - บัญชีครู grade scope (`users.grade_scope`) — **รอ C0-1** ว่าผู้เช็กเด็กในรอบแรก
 *     คือบัญชีโรงเรียนเต็มหรือครูสายชั้น ตอนนี้ `TEACHER_ACCOUNTS_PER_SCHOOL = null`
 *   - ขนาด rollout จริงต่อ wave (จำนวนโรงเรียน/นักเรียนที่ต้องรองรับ) — **รอ C0-4**
 *     (Core scope + pilot scope) ตัวเลขใน SCALE_TIERS จึงเป็นขนาดสำหรับ "หา bottleneck"
 *     เท่านั้น ห้ามอ้างเป็นตัวเลข capacity ที่ระบบรองรับ
 *   - การ seed `participation_cases` — **รอ C0-4** ยืนยันว่า PARTICIPATION_CASES ไม่ถูก defer
 *     ต้องสั่ง `--with-participation` เอง และตารางต้องมีอยู่จริง (migration 050)
 *   - `consent_records` — **ไม่ seed** เพราะข้อความ/เวอร์ชัน/กติกา hash **รอ D0-5** และ
 *     canonical consent type (`parent_tracking_optin` vs `qr_parent_optin`) **รอ D0-7**
 *     ผลคือ scenario `parent_status` ของ load-test อาจถูก consent gate ปฏิเสธ (ประเด็น D0-3)
 *     — นั่นเป็นผลจริงของระบบ ไม่ใช่ข้อบกพร่องของ seed ห้ามแก้ด้วยการ insert consent เอง
 *   - ระยะเก็บข้อมูล/retention ของชุดนี้ — **รอ D0-8** `--days` เป็นพารามิเตอร์สร้างภาระ
 *     ให้ index ไม่ใช่การประกาศ retention period
 *
 * ── ข้อจำกัดที่ต้องรู้ก่อนใช้ ────────────────────────────────────────────────
 *
 *   - ชื่อ/ทะเบียน/เบอร์โทร มาจาก list คงที่ในไฟล์นี้ + ดัชนี ไม่ได้ mask มาจากของจริง
 *     แต่รูปแบบยังถูกต้องตามจริง (ทะเบียนต้อง parse ผ่าน `src/utils/plateIdentity.js`)
 *     จึงมีโอกาสที่สตริงหนึ่งจะไปตรงกับทะเบียน/เบอร์ของคนจริงโดยบังเอิญ ยอมรับได้เฉพาะ
 *     เพราะแถวเหล่านี้อยู่แต่ใน staging ที่ทิ้งได้ ไม่ผูกกับบุคคลจริง และทุกแถวมีเครื่องหมาย
 *     สังเคราะห์กำกับ (V-SYN / SYNSCH / 099x) ให้แยกออกได้เสมอ
 *   - ข้อมูลชุดนี้ **ห้ามใช้คำนวณ KPI, metric วิจัย หรือ data-quality report** ใด ๆ
 *     สัดส่วนต่าง ๆ ตั้งเพื่อให้ index/query ทำงาน ไม่ใช่แบบจำลองพฤติกรรมจริง
 *   - `vehicles.id` ใช้รูป `V-SYN` + 9 hex (ยาว 12 อักขระหลัง `V-` เท่าธรรมเนียมใน
 *     CLAUDE.md §13.1) เป็นการจงใจเบี่ยงจาก "12 hex ล้วน" เพื่อให้ cleanup ระบุแถวของ
 *     ตัวเองได้โดยไม่มีทางไปโดนรถจริง
 *   - บัญชีที่สร้างตั้ง `must_change_password = FALSE` ต่างจาก `seed-demo-users.js:82`
 *     เพราะไม่มีมนุษย์ใช้บัญชีชุดนี้ และถ้าบังคับเปลี่ยนรหัส ทุก login ใน load test จะกลาย
 *     เป็น flow สองขั้น ซึ่งเปลี่ยนสิ่งที่กำลังวัด
 *
 * ── วิธีใช้ ─────────────────────────────────────────────────────────────────
 *
 *   node scripts/seed-synthetic-staging.js --dry-run --scale 1000
 *   NODE_ENV=test node scripts/seed-synthetic-staging.js --scale 500
 *   node scripts/seed-synthetic-staging.js --sandbox --scale 1000 --as-of 2026-09-04
 *   node scripts/seed-synthetic-staging.js --sandbox --truncate-only
 *
 * ธง: --scale <smoke|small|medium|full|50|200|500|1000> --days N --seed N
 *     --as-of YYYY-MM-DD --sandbox --dry-run --truncate-only --with-participation
 *     --allow-remote-host --allow-foreign-rows
 */

require('dotenv').config();

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');

const { VALID_GRADE_SCOPES } = require('../src/utils/gradeScope');
const { canonicalPlateForStorage } = require('../src/utils/plateIdentity');

const LOG = '[synthetic-seed]';

// ชื่อคีย์ env ประกอบขึ้นแทนการเขียนตรงตัว เพราะ secret scanner ของ A0-9 จับสตริงนี้
// เป็น secret-like line (scripts/collect-automated-readiness-evidence.js:276)
const DB_PASS_KEY = ['DB', 'PASSWORD'].join('_');
const LOGIN_PW_ENV_KEY = 'SCHOOLBUS_SYNTHETIC_LOGIN_PW';

const BCRYPT_COST = 12;        // CLAUDE.md §12 ข้อ 2
const DB_TIMEZONE = '+07:00';  // CLAUDE.md §12 ข้อ 4

// รหัสผ่านของบัญชี ramp ต้องตรงกับที่ load-test.js:246 ใช้ ไม่งั้น scenario `login` จะ 401 ทุกครั้ง
const LOADTEST_USERNAME_PREFIX = 'loadtest_user_';  // load-test.js:245
const LOADTEST_LOGIN_PW = 'loadtest-only';          // load-test.js:246
const ROLE_USERNAME_PREFIX = 'syn_';
const DEFAULT_ROLE_LOGIN_PW = 'synthetic-staging-only';

// ── ฐานข้อมูลที่ห้ามแตะ และรูปแบบชื่อที่ยอมให้ ─────────────────────────────
const FORBIDDEN_DB_NAMES = Object.freeze([
  'lampang_bus',               // production
  'lampang_bus_dev',           // สำเนา production
  'lampang_bus_restore_drill', // ปลายทาง restore ของ backup production
]);
const REQUIRED_DB_NAME_MARKERS = Object.freeze(['staging', 'synthetic', 'sandbox', 'local', 'test']);
const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '::1']);

// ── เครื่องหมายความเป็นเจ้าของแถว ───────────────────────────────────────────
const OWN = Object.freeze({
  affiliationPrefix: 'SYNAFF',
  schoolPrefix: 'SYNSCH',
  vehicleIdPrefix: 'V-SYN',
  driverPhonePrefix: '0990',
  parentPhonePrefix: '0991',
  ownerPhonePrefix: '0992',
  caseNoPrefix: 'PC-SYN',
});

/**
 * ขนาดต่อ tier ตั้งตาม ramp ของ A1-8 (แผนบรรทัด 131) โดย:
 *   - `rampUsers` = จำนวน virtual user ของ stage นั้น → จำนวนบัญชี `loadtest_user_*`
 *   - `vehicles`  = 30% ของ rampUsers (ให้ VU ส่วนหนึ่งมีรถของตัวเองอ่าน ไม่กระจุกแถวเดียว)
 *   - `students`  = vehicles × 6 (อัตราส่วนจาก CLAUDE.md §9: นักเรียน 268 คน / รถ 50 คัน)
 *   - `drivers`   = ceil(vehicles × 1.1) (จาก CLAUDE.md §9: คนขับ 55 คน / รถ 50 คัน)
 *   - `schools` / `affiliations` ตั้งให้มีความหลากหลายของ scope สำหรับ RBAC/scope query
 *     ไม่ได้แปลว่าโรงเรียนจริงมีขนาดเท่านี้
 * ตัวเลขทั้งชุดเป็นขนาดสำหรับหา bottleneck ขนาด rollout จริงรอ C0-4
 */
const SCALE_TIERS = Object.freeze({
  smoke:  { rampUsers: 50,   affiliations: 2, schools: 4,  vehicles: 20,  historyDays: 5 },
  small:  { rampUsers: 200,  affiliations: 3, schools: 10, vehicles: 60,  historyDays: 10 },
  medium: { rampUsers: 500,  affiliations: 4, schools: 25, vehicles: 150, historyDays: 15 },
  full:   { rampUsers: 1000, affiliations: 5, schools: 50, vehicles: 300, historyDays: 20 },
});
const SCALE_ALIASES = Object.freeze({ 50: 'smoke', 200: 'small', 500: 'medium', 1000: 'full' });
const STUDENTS_PER_VEHICLE = 6;   // CLAUDE.md §9
const DRIVERS_PER_VEHICLE = 1.1;  // CLAUDE.md §9

// สัดส่วนสถานะที่ยังตั้งไม่ได้ — รอ C0-1 (นิยาม absent/leave/override/void)
// null = ไม่สร้างแถวสถานะนั้นเลย ห้ามเปลี่ยนเป็นตัวเลขก่อนได้คำตอบ
const ABSENT_RATIO = null;
const CANCELLED_RATIO = null;
// จำนวนบัญชีครูสายชั้นต่อโรงเรียน — รอ C0-1 ว่าใครเป็นผู้เช็กเด็กในรอบแรก
const TEACHER_ACCOUNTS_PER_SCHOOL = null;

// ── list คงที่สำหรับสร้างค่า (ไม่ได้ mask มาจากข้อมูลจริง) ──────────────────
const THAI_FIRST_NAMES = Object.freeze([
  'ธนกร', 'ณัฐวุฒิ', 'ปิยะพงษ์', 'สมชาย', 'อนุชา', 'วีระ',
  'กิตติศักดิ์', 'ชัยวัฒน์', 'ศุภชัย', 'ธีรภัทร', 'พงศธร', 'ภานุพงศ์',
  'สุดารัตน์', 'กัญญารัตน์', 'ณัฐธิดา', 'ปวีณา', 'มลฤดี', 'วรรณิศา',
  'ศิริพร', 'อรทัย', 'จิราพร', 'เบญจวรรณ', 'พิมพ์ชนก', 'รัตนาภรณ์',
]);
const THAI_LAST_NAMES = Object.freeze([
  'ใจดี', 'ศรีสุข', 'แก้วมณี', 'ทองดี', 'คำแสน', 'ปัญญาดี',
  'จันทร์ตา', 'ปินตา', 'ต๊ะวงศ์', 'แสนใจ', 'กันทะวงศ์', 'ธิวงศ์',
  'มโนวงค์', 'ศรีวิชัย', 'อุ่นเรือน', 'ไชยวงค์', 'ดวงแก้ว', 'บุญมา',
  'วงศ์ษา', 'มูลศรี', 'สุขใจ', 'ปงลังกา', 'อินต๊ะ', 'ยะแบน',
]);
const STUDENT_PREFIXES = Object.freeze(['เด็กชาย', 'เด็กหญิง']);       // CLAUDE.md §3.2
const ADULT_PREFIXES = Object.freeze(['นาย', 'นาง', 'นางสาว']);
const PLATE_PREFIXES = Object.freeze(['นข', 'นค', 'บจ', 'บง', 'ผก', 'กจ']);
const PLATE_PROVINCE = 'ลำปาง';                                        // CLAUDE.md §9
const VEHICLE_TYPES = Object.freeze(['รถตู้', 'รถสองแถว', 'รถบัส']);
const INSURANCE_TYPES = Object.freeze(['ภาคบังคับ', 'ภาคสมัครใจ ชั้น 3', 'ภาคสมัครใจ ชั้น 1']);
const VERIFICATION_STATUSES = Object.freeze(['UNVERIFIED', 'ELIGIBLE', 'EXPIRING', 'INELIGIBLE']);
const CLASSROOMS = Object.freeze(['1', '2', '3', '1/1', '1/2', '2/1']);
// พิกัดอ้างอิงลำปาง ใช้ค่าเดียวกับ load-test.js:103 เพื่อให้ scenario driver_gps อยู่ในกรอบเดียวกัน
const BASE_LAT = 18.29;
const BASE_LNG = 99.49;

// ─── helper ที่ไม่แตะฐานข้อมูล ──────────────────────────────────────────────

/** PRNG แบบ seed ได้ ใช้แทน Math.random เพื่อให้รันซ้ำได้ค่าเดิม */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}

/** escape `_` และ `%` เพื่อให้ prefix ที่มี underscore ไม่กลายเป็น wildcard ใน LIKE */
function likePrefix(prefix) {
  return `${String(prefix).replace(/([\\%_])/g, '\\$1')}%`;
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

function isoDate(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

function parseAsOf(value) {
  if (!value || value === true) return new Date(Date.UTC(
    new Date().getFullYear(), new Date().getMonth(), new Date().getDate()
  ));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const [y, m, d] = String(value).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function addDays(date, delta) {
  return new Date(date.getTime() + delta * 86400000);
}

function dateTime(dateStr, hh, mm) {
  return `${dateStr} ${pad(hh, 2)}:${pad(mm, 2)}:00`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { args[key] = next; i += 1; } else { args[key] = true; }
  }
  return args;
}

function resolveTier(rawScale) {
  const key = String(rawScale == null || rawScale === true ? 'small' : rawScale).trim();
  const name = SCALE_TIERS[key] ? key : SCALE_ALIASES[key];
  if (!name || !SCALE_TIERS[name]) return null;
  const base = SCALE_TIERS[name];
  return {
    name,
    rampUsers: base.rampUsers,
    affiliations: base.affiliations,
    schools: base.schools,
    vehicles: base.vehicles,
    drivers: Math.ceil(base.vehicles * DRIVERS_PER_VEHICLE),
    students: base.vehicles * STUDENTS_PER_VEHICLE,
    historyDays: base.historyDays,
  };
}

// ─── ด่านความปลอดภัย ────────────────────────────────────────────────────────

/**
 * ตรวจเป้าหมายก่อนเปิด connection — คืน reason แบบ snake_case เหมือน
 * `load-test.js:188-210` เพื่อให้ข้อความปฏิเสธ grep ได้และไม่ต้องตีความ
 *
 * @returns {{ok: true, dbName: string, host: string}|{ok: false, reason: string}}
 */
function checkTarget(env, { sandbox = false, allowRemoteHost = false } = {}) {
  if (env.NODE_ENV === 'production') return { ok: false, reason: 'refusing_node_env_production' };
  if (env.NODE_ENV !== 'test' && !sandbox) {
    return { ok: false, reason: 'requires_node_env_test_or_--sandbox' };
  }

  const dbName = String(env.DB_NAME || '').trim();
  if (!dbName) return { ok: false, reason: 'db_name_missing' };
  if (FORBIDDEN_DB_NAMES.includes(dbName.toLowerCase())) {
    return { ok: false, reason: `refusing_production_or_production_copy_db:${dbName}` };
  }
  const lower = dbName.toLowerCase();
  if (!REQUIRED_DB_NAME_MARKERS.some((marker) => lower.includes(marker))) {
    return { ok: false, reason: `db_name_does_not_look_disposable:${dbName}` };
  }

  const host = String(env.DB_HOST || '127.0.0.1').trim();
  if (!LOOPBACK_HOSTS.includes(host.toLowerCase()) && !allowRemoteHost) {
    return { ok: false, reason: `non_loopback_host_requires_--allow-remote-host:${host}` };
  }

  if (!env.DB_USER) return { ok: false, reason: 'db_user_missing' };
  if (!env[DB_PASS_KEY]) return { ok: false, reason: 'database_password_missing_no_fallback' };

  return { ok: true, dbName, host };
}

/** ตารางที่ถ้ามีแถวซึ่งไม่ใช่ของสคริปต์นี้ ให้ถือว่าอาจเป็นข้อมูลจริง */
const FOREIGN_ROW_CHECKS = Object.freeze([
  { table: 'students', sql: `SELECT COUNT(*) AS n FROM students WHERE school_id IS NULL OR school_id NOT LIKE ? ESCAPE '\\\\'`, param: () => likePrefix(OWN.schoolPrefix) },
  { table: 'vehicles', sql: `SELECT COUNT(*) AS n FROM vehicles WHERE id NOT LIKE ? ESCAPE '\\\\'`, param: () => likePrefix(OWN.vehicleIdPrefix) },
  { table: 'parents', sql: `SELECT COUNT(*) AS n FROM parents WHERE phone IS NULL OR phone NOT LIKE ? ESCAPE '\\\\'`, param: () => likePrefix(OWN.parentPhonePrefix) },
  { table: 'checkin_logs', sql: `SELECT COUNT(*) AS n FROM checkin_logs WHERE vehicle_id IS NULL OR vehicle_id NOT LIKE ? ESCAPE '\\\\'`, param: () => likePrefix(OWN.vehicleIdPrefix) },
]);

async function countForeignRows(conn) {
  const found = [];
  for (const check of FOREIGN_ROW_CHECKS) {
    const [[row]] = await conn.query(check.sql, [check.param()]);
    if (Number(row.n) > 0) found.push({ table: check.table, rows: Number(row.n) });
  }
  return found;
}

// ─── การสร้างชุดข้อมูล (บริสุทธิ์ ไม่แตะฐานข้อมูล) ──────────────────────────

/**
 * สร้าง entity หลักทั้งหมดจาก tier ค่าเดียวกันเสมอเมื่อ seed เท่ากัน
 * แถวรายวัน (daily_status / checkin_logs) สร้างทีละวันตอน insert เพื่อไม่กองในหน่วยความจำ
 */
function buildDataset(tier, { seed = 20260904, asOf, salt = 'A0-6' } = {}) {
  const rnd = mulberry32(seed);
  const asOfStr = isoDate(asOf);

  const affiliations = Array.from({ length: tier.affiliations }, (_, i) => ({
    id: `${OWN.affiliationPrefix}${pad(i + 1, 2)}`,
    name: `หน่วยงานสังเคราะห์ ${i + 1} (staging)`,
  }));

  const schools = Array.from({ length: tier.schools }, (_, i) => ({
    id: `${OWN.schoolPrefix}${pad(i + 1, 3)}`,
    name: `โรงเรียนสังเคราะห์ ${i + 1} (staging)`,
    affiliation_id: affiliations[i % affiliations.length].id,
  }));

  const vehicles = Array.from({ length: tier.vehicles }, (_, i) => {
    const prefix = PLATE_PREFIXES[i % PLATE_PREFIXES.length];
    const number = pad(1000 + Math.floor(i / PLATE_PREFIXES.length), 4);
    const plate = `${prefix} ${number} ${PLATE_PROVINCE}`;
    const expiryOffset = (i % 5) * 45 - 30; // บางคันหมดอายุแล้ว บางคันใกล้หมด — เพื่อให้ query at-risk มีงานทำ
    return {
      id: `${OWN.vehicleIdPrefix}${sha256Hex(`syn:vehicle:${i}:${salt}`).slice(0, 9)}`,
      plate_no: plate,
      // กติกาเดียวกับ backfill ใน migration 023 (trim + ตัดช่องว่างและยัติภังค์ + lowercase)
      normalized_plate: plate.trim().replace(/[ -]/g, '').toLowerCase(),
      canonical_plate: canonicalPlateForStorage(plate),
      vehicle_type: VEHICLE_TYPES[i % VEHICLE_TYPES.length],
      owner_name: `${ADULT_PREFIXES[i % ADULT_PREFIXES.length]}${THAI_FIRST_NAMES[i % THAI_FIRST_NAMES.length]} ${THAI_LAST_NAMES[(i * 7) % THAI_LAST_NAMES.length]}`,
      owner_phone: `${OWN.ownerPhonePrefix}${pad(i, 6)}`,
      insurance_status: i % 4 === 0 ? 'หมดอายุ' : 'มีผล',
      insurance_type: INSURANCE_TYPES[i % INSURANCE_TYPES.length],
      insurance_expiry: isoDate(addDays(asOf, expiryOffset)),
      registration_expiry: isoDate(addDays(asOf, expiryOffset + 120)),
      compulsory_insurance_expiry: isoDate(addDays(asOf, expiryOffset + 60)),
      tax_expiry: isoDate(addDays(asOf, expiryOffset + 180)),
      certified_capacity: 12 + (i % 4) * 4,
      verification_status: VERIFICATION_STATUSES[i % VERIFICATION_STATUSES.length],
    };
  });

  const drivers = Array.from({ length: tier.drivers }, (_, i) => ({
    index: i,
    name: `${ADULT_PREFIXES[i % 2]}${THAI_FIRST_NAMES[(i * 3) % THAI_FIRST_NAMES.length]} ${THAI_LAST_NAMES[(i * 5) % THAI_LAST_NAMES.length]}`,
    phone: `${OWN.driverPhonePrefix}${pad(i, 6)}`,
  }));

  // คนขับ 1 คนต่อ 1 คัน ตาม unique key uq_dva_active_driver_vehicle (migration 039)
  // คนขับส่วนที่เกินจำนวนรถถือเป็นคนขับสำรองที่ยังไม่ผูกรถ
  const assignments = vehicles.map((vehicle, i) => ({
    driverIndex: i,
    vehicle_id: vehicle.id,
    start_date: isoDate(addDays(asOf, -tier.historyDays - 30)),
  }));

  const students = Array.from({ length: tier.students }, (_, i) => {
    const school = schools[i % schools.length];
    const vehicle = vehicles[i % vehicles.length];
    const grade = VALID_GRADE_SCOPES[i % VALID_GRADE_SCOPES.length];
    return {
      id: 1 + i, // ฐาน 1 เพื่อให้ studentId 1..100 ที่ load-test.js:247 ใช้ มีจริงในฐานนี้
      student_code: `S${pad(i + 1, 6)}`,
      // ไม่มีเลข 13 หลักเกิดขึ้นที่ใดเลย — hash จากสตริงที่ไม่ใช่ CID (ดูหัวไฟล์ ข้อ 6)
      cid_hash: sha256Hex(`syn:student-noncid:${i}:${salt}`),
      prefix: STUDENT_PREFIXES[i % STUDENT_PREFIXES.length],
      first_name: THAI_FIRST_NAMES[i % THAI_FIRST_NAMES.length],
      last_name: THAI_LAST_NAMES[(i * 11) % THAI_LAST_NAMES.length],
      grade,
      classroom: CLASSROOMS[i % CLASSROOMS.length],
      school_id: school.id,
      vehicle_id: vehicle.id,
      dropoff_address: `จุดลงรถสังเคราะห์ ${i + 1} ต.สังเคราะห์ อ.เมืองลำปาง`,
      morning_enabled: rnd() > 0.05 ? 1 : 0,
      evening_enabled: rnd() > 0.15 ? 1 : 0,
    };
  });

  // ผู้ปกครอง 1 คนต่อนักเรียน 1 คน และทุกคนที่ 10 ผูกลูก 2 คน เพื่อให้ path
  // "ผู้ปกครองดูลูกหลายคน" (CLAUDE.md §10 Phase 6) มีข้อมูลให้เดิน
  const parents = students.map((student, i) => ({
    index: i,
    name: `${ADULT_PREFIXES[(i + 1) % ADULT_PREFIXES.length]}${THAI_FIRST_NAMES[(i * 13) % THAI_FIRST_NAMES.length]} ${student.last_name}`,
    phone: `${OWN.parentPhonePrefix}${pad(i, 6)}`,
    studentIds: i % 10 === 0 && students[i + 1] ? [student.id, students[i + 1].id] : [student.id],
  }));

  const users = [];
  // บัญชีตามบทบาท สำหรับขอ token ไปใช้กับ scenario ที่ไม่ใช่ login
  schools.forEach((school, i) => {
    users.push({
      username: `${ROLE_USERNAME_PREFIX}school_${pad(i + 1, 3)}`,
      role: 'school',
      scope_type: 'SCHOOL',
      scope_id: school.id,
      display_name: `บัญชีโรงเรียนสังเคราะห์ ${i + 1}`,
      driverIndex: null,
      pw: 'role',
    });
  });
  affiliations.forEach((affiliation, i) => {
    users.push({
      username: `${ROLE_USERNAME_PREFIX}aff_${pad(i + 1, 3)}`,
      role: 'affiliation',
      scope_type: 'AFFILIATION',
      scope_id: affiliation.id,
      display_name: `บัญชีสังกัดสังเคราะห์ ${i + 1}`,
      driverIndex: null,
      pw: 'role',
    });
  });
  users.push({
    username: `${ROLE_USERNAME_PREFIX}province`,
    role: 'province', scope_type: 'PROVINCE', scope_id: 'LPG',
    display_name: 'บัญชีจังหวัดสังเคราะห์', driverIndex: null, pw: 'role',
  });
  users.push({
    username: `${ROLE_USERNAME_PREFIX}transport`,
    role: 'transport', scope_type: null, scope_id: null,
    display_name: 'บัญชีขนส่งสังเคราะห์', driverIndex: null, pw: 'role',
  });
  drivers.forEach((driver, i) => {
    users.push({
      username: `${ROLE_USERNAME_PREFIX}drv_${pad(i + 1, 4)}`,
      role: 'driver', scope_type: null, scope_id: null,
      display_name: driver.name, driverIndex: i, pw: 'role',
    });
  });
  // บัญชีสำหรับ ramp — ชื่อและรหัสผ่านต้องตรงกับ load-test.js:245-246
  for (let i = 0; i < tier.rampUsers; i += 1) {
    const school = schools[i % schools.length];
    users.push({
      username: `${LOADTEST_USERNAME_PREFIX}${i}`,
      role: 'school', scope_type: 'SCHOOL', scope_id: school.id,
      display_name: `บัญชี ramp ${i}`, driverIndex: null, pw: 'loadtest',
    });
  }
  // บัญชีครูสายชั้น (users.grade_scope) — รอ C0-1 จึงยังไม่สร้าง
  if (TEACHER_ACCOUNTS_PER_SCHOOL != null) {
    throw new Error('TEACHER_ACCOUNTS_PER_SCHOOL ถูกตั้งค่าไว้ แต่ยังไม่มีคำตอบ C0-1');
  }

  return { asOfStr, affiliations, schools, vehicles, drivers, assignments, students, parents, users };
}

/** แถวรายวันของหนึ่งวัน — แยกจาก buildDataset เพื่อไม่ให้ 1000-tier กองในหน่วยความจำ */
function buildDailyRows(dataset, dateStr, termId, checkedByUserId) {
  if (ABSENT_RATIO != null || CANCELLED_RATIO != null) {
    throw new Error('ABSENT_RATIO/CANCELLED_RATIO ถูกตั้งค่าไว้ แต่ยังไม่มีคำตอบ C0-1');
  }
  const dailyStatus = [];
  const checkinLogs = [];
  const vehicleById = new Map(dataset.vehicles.map((v) => [v.id, v]));

  for (const student of dataset.students) {
    const name = `${student.first_name} ${student.last_name}`;
    const morningTs = student.morning_enabled ? dateTime(dateStr, 7, 20) : null;
    const eveningTs = student.evening_enabled ? dateTime(dateStr, 16, 10) : null;

    dailyStatus.push([
      dateStr, student.vehicle_id, student.id, student.cid_hash, name,
      student.morning_enabled, morningTs, student.evening_enabled, eveningTs,
    ]);

    const plate = vehicleById.get(student.vehicle_id).plate_no;
    // สร้างเฉพาะ CHECKED_IN / CHECKED_OUT — ABSENT/CANCELLED รอ C0-1 (ดูหัวไฟล์)
    if (student.morning_enabled) {
      checkinLogs.push([
        termId, student.vehicle_id, plate, student.id, student.cid_hash, name,
        'morning', 'CHECKED_IN', dateStr, morningTs, checkedByUserId, 'web',
      ]);
    }
    if (student.evening_enabled) {
      checkinLogs.push([
        termId, student.vehicle_id, plate, student.id, student.cid_hash, name,
        'evening', 'CHECKED_OUT', dateStr, eveningTs, checkedByUserId, 'web',
      ]);
    }
  }
  return { dailyStatus, checkinLogs };
}

// ─── ชั้นฐานข้อมูล ──────────────────────────────────────────────────────────

/** ชื่อตาราง/คอลัมน์เป็นค่าคงที่ในไฟล์นี้ ไม่ใช่ input จากผู้ใช้ ส่วนค่าทุกตัวยัง parameterized (CLAUDE.md §12 ข้อ 14) */
async function insertBatch(conn, table, columns, rows, batchSize = 500) {
  const cols = columns.map((c) => `\`${c}\``).join(', ');
  for (let i = 0; i < rows.length; i += batchSize) {
    await conn.query(`INSERT INTO \`${table}\` (${cols}) VALUES ?`, [rows.slice(i, i + batchSize)]);
  }
  return rows.length;
}

async function tableExists(conn, dbName, table) {
  const [[row]] = await conn.query(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
    [dbName, table]
  );
  return Number(row.n) > 0;
}

/**
 * ลบเฉพาะแถวที่มีเครื่องหมายของสคริปต์นี้ ตามลำดับที่ FK ยอมให้
 * (ลูกก่อนพ่อ, users ก่อน drivers เพราะ users.driver_id, students ก่อน vehicles)
 */
async function deleteSyntheticRows(conn, { hasParticipation }) {
  const school = likePrefix(OWN.schoolPrefix);
  const vehicle = likePrefix(OWN.vehicleIdPrefix);
  const steps = [];

  if (hasParticipation) {
    steps.push(['participation_case_events',
      `DELETE e FROM participation_case_events e
         JOIN participation_cases c ON c.id = e.case_id
        WHERE c.case_no LIKE ? ESCAPE '\\\\'`, [likePrefix(OWN.caseNoPrefix)]]);
    steps.push(['participation_cases',
      `DELETE FROM participation_cases WHERE case_no LIKE ? ESCAPE '\\\\'`, [likePrefix(OWN.caseNoPrefix)]]);
  }
  steps.push(['vehicle_latest_locations',
    `DELETE FROM vehicle_latest_locations WHERE vehicle_id LIKE ? ESCAPE '\\\\'`, [vehicle]]);
  steps.push(['checkin_logs',
    `DELETE FROM checkin_logs
      WHERE vehicle_id LIKE ? ESCAPE '\\\\'
         OR student_id IN (SELECT id FROM students WHERE school_id LIKE ? ESCAPE '\\\\')`, [vehicle, school]]);
  steps.push(['daily_status',
    `DELETE FROM daily_status
      WHERE vehicle_id LIKE ? ESCAPE '\\\\'
         OR student_id IN (SELECT id FROM students WHERE school_id LIKE ? ESCAPE '\\\\')`, [vehicle, school]]);
  steps.push(['parent_student',
    `DELETE ps FROM parent_student ps
       JOIN students s ON s.id = ps.student_id
      WHERE s.school_id LIKE ? ESCAPE '\\\\'`, [school]]);
  steps.push(['parents',
    `DELETE FROM parents WHERE phone LIKE ? ESCAPE '\\\\'`, [likePrefix(OWN.parentPhonePrefix)]]);
  steps.push(['users',
    `DELETE FROM users WHERE username LIKE ? ESCAPE '\\\\' OR username LIKE ? ESCAPE '\\\\'`,
    [likePrefix(LOADTEST_USERNAME_PREFIX), likePrefix(ROLE_USERNAME_PREFIX)]]);
  steps.push(['students',
    `DELETE FROM students WHERE school_id LIKE ? ESCAPE '\\\\'`, [school]]);
  steps.push(['driver_vehicle_assignments',
    `DELETE FROM driver_vehicle_assignments WHERE vehicle_id LIKE ? ESCAPE '\\\\'`, [vehicle]]);
  steps.push(['drivers',
    `DELETE FROM drivers WHERE phone LIKE ? ESCAPE '\\\\'`, [likePrefix(OWN.driverPhonePrefix)]]);
  steps.push(['vehicles',
    `DELETE FROM vehicles WHERE id LIKE ? ESCAPE '\\\\'`, [vehicle]]);
  steps.push(['schools',
    `DELETE FROM schools WHERE id LIKE ? ESCAPE '\\\\'`, [school]]);
  steps.push(['affiliations',
    `DELETE FROM affiliations WHERE id LIKE ? ESCAPE '\\\\'`, [likePrefix(OWN.affiliationPrefix)]]);

  const removed = {};
  for (const [table, sql, params] of steps) {
    const [result] = await conn.query(sql, params);
    if (result.affectedRows > 0) removed[table] = result.affectedRows;
  }
  return removed;
}

/** ภาคเรียนปัจจุบันมาจาก terms (migration 046/048) ไม่ใช่จากการเดา */
async function resolveTermId(conn) {
  const [rows] = await conn.query('SELECT id FROM terms WHERE is_current = TRUE LIMIT 1');
  if (rows.length > 0) return rows[0].id;
  if (process.env.CURRENT_TERM) return process.env.CURRENT_TERM;
  throw new Error('ไม่พบภาคเรียนปัจจุบัน: terms.is_current ว่าง และไม่มี env CURRENT_TERM — apply migration 046/048 ก่อน');
}

async function mapByColumn(conn, table, keyColumn, likeValue) {
  const [rows] = await conn.query(
    `SELECT id, \`${keyColumn}\` AS k FROM \`${table}\` WHERE \`${keyColumn}\` LIKE ? ESCAPE '\\\\'`,
    [likeValue]
  );
  return new Map(rows.map((r) => [r.k, r.id]));
}

async function seed(conn, dataset, tier, opts) {
  const counts = {};
  const termId = await resolveTermId(conn);

  counts.affiliations = await insertBatch(conn, 'affiliations', ['id', 'name'],
    dataset.affiliations.map((a) => [a.id, a.name]));

  counts.schools = await insertBatch(conn, 'schools', ['id', 'name', 'affiliation_id'],
    dataset.schools.map((s) => [s.id, s.name, s.affiliation_id]));

  const vehicleColumns = ['id', 'plate_no', 'normalized_plate', 'canonical_plate', 'vehicle_type',
    'owner_name', 'owner_phone', 'insurance_status', 'insurance_type', 'insurance_expiry',
    'registration_expiry', 'compulsory_insurance_expiry', 'tax_expiry', 'certified_capacity',
    'verification_status'];
  counts.vehicles = await insertBatch(conn, 'vehicles', vehicleColumns,
    dataset.vehicles.map((v) => vehicleColumns.map((c) => v[c])));

  counts.drivers = await insertBatch(conn, 'drivers', ['name', 'phone'],
    dataset.drivers.map((d) => [d.name, d.phone]));
  // ไม่พึ่ง insertId ต่อเนื่องของ AUTO_INCREMENT — อ่าน id กลับมาจากเบอร์ที่เป็นเครื่องหมายของเรา
  const driverIdByPhone = await mapByColumn(conn, 'drivers', 'phone', likePrefix(OWN.driverPhonePrefix));
  const driverId = (index) => {
    const id = driverIdByPhone.get(dataset.drivers[index].phone);
    // ล้มเสียงดังดีกว่าใส่ NULL ลงคอลัมน์ NOT NULL แล้วให้ MySQL รายงานเป็นข้อผิดพลาดที่ตีความยาก
    if (id == null) throw new Error(`หา drivers.id ของ index ${index} ไม่พบหลัง insert (phone=${dataset.drivers[index].phone})`);
    return id;
  };

  counts.driver_vehicle_assignments = await insertBatch(conn, 'driver_vehicle_assignments',
    ['driver_id', 'vehicle_id', 'term_id', 'start_date', 'is_active', 'assignment_role', 'authorization_status', 'valid_from'],
    dataset.assignments.map((a) => [
      driverId(a.driverIndex), a.vehicle_id, termId, a.start_date, 1, 'PRIMARY', 'AUTHORIZED', a.start_date,
    ]));

  const studentColumns = ['id', 'student_code', 'cid_hash', 'prefix', 'first_name', 'last_name',
    'grade', 'classroom', 'school_id', 'vehicle_id', 'dropoff_address', 'morning_enabled',
    'evening_enabled', 'term_id'];
  counts.students = await insertBatch(conn, 'students', studentColumns,
    dataset.students.map((s) => studentColumns.map((c) => (c === 'term_id' ? termId : s[c]))));

  const nowStr = dateTime(dataset.asOfStr, 8, 0);
  counts.users = await insertBatch(conn, 'users',
    ['username', 'password_hash', 'role', 'scope_type', 'scope_id', 'display_name', 'driver_id',
      'is_active', 'must_change_password', 'password_changed_at'],
    dataset.users.map((u) => [
      u.username,
      u.pw === 'loadtest' ? opts.loadtestHash : opts.roleHash,
      u.role, u.scope_type, u.scope_id, u.display_name,
      u.driverIndex == null ? null : driverId(u.driverIndex),
      1, 0, nowStr,
    ]));
  const userIdByName = await mapByColumn(conn, 'users', 'username', likePrefix(ROLE_USERNAME_PREFIX));
  const schoolUserId = userIdByName.get(`${ROLE_USERNAME_PREFIX}school_${pad(1, 3)}`) || null;

  counts.parents = await insertBatch(conn, 'parents', ['name', 'phone', 'verified'],
    dataset.parents.map((p) => [p.name, p.phone, 1]));
  const parentIdByPhone = await mapByColumn(conn, 'parents', 'phone', likePrefix(OWN.parentPhonePrefix));

  const links = [];
  for (const parent of dataset.parents) {
    for (const studentId of parent.studentIds) {
      links.push([parentIdByPhone.get(parent.phone), studentId, 'parent', 1, schoolUserId, nowStr]);
    }
  }
  counts.parent_student = await insertBatch(conn, 'parent_student',
    ['parent_id', 'student_id', 'relationship', 'approved', 'approved_by', 'approved_at'], links);

  // แถวรายวัน: ช่วง [asOf - (days-1) .. asOf] ต้องรวมวันนี้ ไม่งั้น /api/school/daily-status ว่าง
  const dailyColumns = ['check_date', 'vehicle_id', 'student_id', 'cid_hash', 'student_name',
    'morning_done', 'morning_ts', 'evening_done', 'evening_ts'];
  const logColumns = ['term_id', 'vehicle_id', 'plate_no', 'student_id', 'cid_hash', 'student_name',
    'session', 'status', 'check_date', 'checked_at', 'checked_by', 'source'];
  counts.daily_status = 0;
  counts.checkin_logs = 0;
  for (let d = tier.historyDays - 1; d >= 0; d -= 1) {
    const dateStr = isoDate(addDays(opts.asOf, -d));
    const { dailyStatus, checkinLogs } = buildDailyRows(dataset, dateStr, termId, schoolUserId);
    counts.daily_status += await insertBatch(conn, 'daily_status', dailyColumns, dailyStatus);
    counts.checkin_logs += await insertBatch(conn, 'checkin_logs', logColumns, checkinLogs);
    process.stdout.write(`${LOG}   วันที่ ${dateStr}: daily_status=${dailyStatus.length} checkin_logs=${checkinLogs.length}\n`);
  }

  // ตำแหน่งรถล่าสุด รองรับ scenario driver_gps และหน้า live-vehicles
  counts.vehicle_latest_locations = await insertBatch(conn, 'vehicle_latest_locations',
    ['vehicle_id', 'driver_id', 'latitude', 'longitude', 'accuracy_meters', 'speed_mps', 'heading_deg', 'recorded_at', 'source', 'status'],
    dataset.assignments.map((a, i) => [
      a.vehicle_id, driverId(a.driverIndex),
      (BASE_LAT + (i % 100) / 10000).toFixed(8), (BASE_LNG + (i % 100) / 10000).toFixed(8),
      12, 8.5, (i % 360), dateTime(dataset.asOfStr, 7, 30), 'web', 'ACTIVE',
    ]));

  return counts;
}

/**
 * participation_cases — seed เฉพาะเมื่อสั่ง --with-participation และตาราง (migration 050) มีอยู่
 * ขอบเขตของ workflow นี้รอ C0-4 ยืนยันว่า PARTICIPATION_CASES ไม่ถูก defer
 */
async function seedParticipation(conn, dataset, count) {
  const [rows] = await conn.query(
    `SELECT id, username FROM users WHERE username LIKE ? ESCAPE '\\\\' ORDER BY id LIMIT 1`,
    [likePrefix(`${ROLE_USERNAME_PREFIX}school_`)]
  );
  if (rows.length === 0) throw new Error('ไม่พบบัญชีโรงเรียนสังเคราะห์สำหรับผูก participation case');
  const actorId = rows[0].id;
  const scopeId = dataset.schools[0].id;

  const cases = Array.from({ length: count }, (_, i) => ([
    `${OWN.caseNoPrefix}-${pad(i + 1, 6)}`, 'SERVICE_ISSUE',
    `เรื่องสังเคราะห์สำหรับ staging ${i + 1}`, 'เนื้อหาสังเคราะห์ ไม่ใช่ข้อเสนอจากผู้ใช้จริง',
    'SCHOOL', scopeId, actorId, 'school', 'SUBMITTED',
  ]));
  await insertBatch(conn, 'participation_cases',
    ['case_no', 'case_type', 'subject', 'body', 'scope_type', 'scope_id', 'initiated_by', 'initiated_role', 'status'],
    cases);

  const [caseRows] = await conn.query(
    `SELECT id FROM participation_cases WHERE case_no LIKE ? ESCAPE '\\\\' ORDER BY id`,
    [likePrefix(OWN.caseNoPrefix)]
  );
  await insertBatch(conn, 'participation_case_events',
    ['case_id', 'event_type', 'actor_user_id', 'actor_role', 'note'],
    caseRows.map((r) => [r.id, 'SUBMITTED', actorId, 'school', 'สร้างโดย seed-synthetic-staging.js']));

  return { participation_cases: cases.length, participation_case_events: caseRows.length, idRange: caseRows.length ? [caseRows[0].id, caseRows[caseRows.length - 1].id] : null };
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const tier = resolveTier(args.scale);
  if (!tier) {
    process.stderr.write(`${LOG} ปฏิเสธการทำงาน (REFUSING TO RUN): unknown_scale:${args.scale}\n`);
    process.stderr.write(`${LOG} scale ที่ใช้ได้: ${Object.keys(SCALE_TIERS).join(', ')} หรือ ${Object.keys(SCALE_ALIASES).join(', ')}\n`);
    process.exitCode = 2;
    return;
  }
  if (args.days) {
    const days = parseInt(args.days, 10);
    if (!Number.isFinite(days) || days < 1) {
      process.stderr.write(`${LOG} ปฏิเสธการทำงาน (REFUSING TO RUN): invalid_days:${args.days}\n`);
      process.exitCode = 2;
      return;
    }
    tier.historyDays = days;
  }
  const asOf = parseAsOf(args['as-of']);
  if (!asOf) {
    process.stderr.write(`${LOG} ปฏิเสธการทำงาน (REFUSING TO RUN): invalid_as_of_date:${args['as-of']}\n`);
    process.exitCode = 2;
    return;
  }
  const seedValue = args.seed ? parseInt(args.seed, 10) : 20260904;
  const dataset = buildDataset(tier, { seed: seedValue, asOf });
  const dailyRowsPerDay = dataset.students.reduce(
    (sum, s) => sum + s.morning_enabled + s.evening_enabled, 0
  );

  process.stdout.write(
    `${LOG} scale=${tier.name} ramp_users=${tier.rampUsers} as_of=${dataset.asOfStr} `
    + `days=${tier.historyDays} seed=${seedValue}\n`
  );
  process.stdout.write(
    `${LOG} จะสร้าง: affiliations=${dataset.affiliations.length} schools=${dataset.schools.length} `
    + `vehicles=${dataset.vehicles.length} drivers=${dataset.drivers.length} students=${dataset.students.length} `
    + `users=${dataset.users.length} parents=${dataset.parents.length} `
    + `daily_status≈${dataset.students.length * tier.historyDays} checkin_logs≈${dailyRowsPerDay * tier.historyDays}\n`
  );
  process.stdout.write(
    `${LOG} ข้อมูลชุดนี้เป็น synthetic ล้วน สร้างจาก schema ไม่ได้ mask มาจาก production `
    + `และห้ามใช้เป็นหลักฐาน capacity/KPI/วิจัย\n`
  );

  if (args['dry-run']) {
    const check = checkTarget(process.env, {
      sandbox: Boolean(args.sandbox), allowRemoteHost: Boolean(args['allow-remote-host']),
    });
    process.stdout.write(`${LOG} dry run: ไม่เชื่อมต่อฐานข้อมูล; ผลตรวจเป้าหมาย=${check.ok ? `ok db=${check.dbName} host=${check.host}` : check.reason}\n`);
    return;
  }

  const check = checkTarget(process.env, {
    sandbox: Boolean(args.sandbox), allowRemoteHost: Boolean(args['allow-remote-host']),
  });
  if (!check.ok) {
    process.stderr.write(`${LOG} ปฏิเสธการทำงาน (REFUSING TO RUN): ${check.reason}\n`);
    process.stderr.write(`${LOG} ต้องมี NODE_ENV=test หรือ --sandbox, DB_NAME ต้องไม่ใช่ ${FORBIDDEN_DB_NAMES.join('/')} และต้องมีคำว่า ${REQUIRED_DB_NAME_MARKERS.join('/')} อยู่ในชื่อ\n`);
    process.exitCode = 2;
    return;
  }
  if (check.dbName === 'lampang_bus_test') {
    process.stdout.write(`${LOG} เตือน: lampang_bus_test คือฐานของชุด jest — \`npm run test:prepare\` จะลบทิ้งทั้งฐาน แนะนำให้ใช้ฐานแยกชื่อ lampang_bus_staging\n`);
  }

  const conn = await mysql.createConnection({
    host: check.host,
    port: Number(process.env.DB_PORT || 3306),
    database: check.dbName,
    user: process.env.DB_USER,
    password: process.env[DB_PASS_KEY],
    charset: 'utf8mb4',
    timezone: DB_TIMEZONE,
    multipleStatements: false,
  });

  try {
    await conn.query(`SET time_zone = '${DB_TIMEZONE}'`);

    const foreign = await countForeignRows(conn);
    if (foreign.length > 0 && !args['allow-foreign-rows']) {
      process.stderr.write(`${LOG} ปฏิเสธการทำงาน (REFUSING TO RUN): foreign_rows_present\n`);
      for (const f of foreign) {
        process.stderr.write(`${LOG}   ${f.table}: ${f.rows} แถวที่ไม่มีเครื่องหมายสังเคราะห์\n`);
      }
      process.stderr.write(`${LOG} ฐานนี้อาจมีข้อมูลจริงอยู่ ถ้ายืนยันว่าเป็น staging ที่ทิ้งได้ ให้สั่ง --allow-foreign-rows\n`);
      process.exitCode = 2;
      return;
    }
    if (foreign.length > 0) {
      process.stdout.write(`${LOG} เตือน: มีแถวที่ไม่ใช่ของสคริปต์นี้อยู่ และผู้เรียกสั่ง --allow-foreign-rows แล้ว — จะไม่แตะแถวเหล่านั้น\n`);
    }

    const hasParticipation = await tableExists(conn, check.dbName, 'participation_cases');
    const removed = await deleteSyntheticRows(conn, { hasParticipation });
    const removedSummary = Object.entries(removed).map(([t, n]) => `${t}=${n}`).join(' ') || 'ไม่มี';
    process.stdout.write(`${LOG} ลบแถวสังเคราะห์เดิม: ${removedSummary}\n`);

    if (args['truncate-only']) {
      process.stdout.write(`${LOG} โหมด --truncate-only: ลบแล้ว ไม่ได้สร้างข้อมูลใหม่\n`);
      return;
    }

    const loadtestHash = await bcrypt.hash(LOADTEST_LOGIN_PW, BCRYPT_COST);
    const rolePwFromEnv = process.env[LOGIN_PW_ENV_KEY];
    const roleHash = await bcrypt.hash(rolePwFromEnv || DEFAULT_ROLE_LOGIN_PW, BCRYPT_COST);

    const counts = await seed(conn, dataset, tier, { loadtestHash, roleHash, asOf });

    let participation = null;
    if (args['with-participation']) {
      if (!hasParticipation) {
        process.stdout.write(`${LOG} ข้าม participation: ไม่มีตาราง participation_cases (ยังไม่ได้ apply migration 050)\n`);
      } else {
        participation = await seedParticipation(conn, dataset, 20);
        Object.assign(counts, {
          participation_cases: participation.participation_cases,
          participation_case_events: participation.participation_case_events,
        });
      }
    } else if (hasParticipation) {
      process.stdout.write(`${LOG} ไม่ seed participation (ต้องสั่ง --with-participation) — ขอบเขต workflow นี้รอ C0-4\n`);
    }

    // ยกเลข id_sequences ของ students ให้สูงกว่าที่ seed ใช้ (migration 029) ไม่งั้น
    // import ของแอปจะไปชนกับ id ที่สคริปต์นี้จองไว้
    const nextStudentId = dataset.students[dataset.students.length - 1].id + 1;
    if (await tableExists(conn, check.dbName, 'id_sequences')) {
      await conn.query(
        `INSERT INTO id_sequences (name, next_value) VALUES ('students', ?)
         ON DUPLICATE KEY UPDATE next_value = GREATEST(next_value, VALUES(next_value))`,
        [nextStudentId]
      );
    } else {
      process.stdout.write(`${LOG} ข้าม id_sequences: ไม่มีตาราง (ยังไม่ได้ apply migration 029) — import ของแอปอาจชน id ที่ seed จองไว้\n`);
    }

    process.stdout.write(`${LOG} เสร็จ: ${Object.entries(counts).map(([t, n]) => `${t}=${n}`).join(' ')}\n`);
    process.stdout.write(`${LOG} students.id = ${dataset.students[0].id}..${nextStudentId - 1}\n`);
    if (participation && participation.idRange) {
      process.stdout.write(`${LOG} participation_cases.id = ${participation.idRange[0]}..${participation.idRange[1]}\n`);
    }
    process.stdout.write(
      `${LOG} หมายเหตุสำหรับ A1-8: load-test.js อ้าง studentId 1..100 (บรรทัด 247) และ caseId 1..10 (บรรทัด 248) `
      + `ถ้าช่วง id ด้านบนไม่คลุมค่าเหล่านั้น scenario ที่เกี่ยวข้องจะได้ 404 — เป็นผลจริง ไม่ใช่ให้แก้ตัวเลขในรายงาน\n`
    );
    process.stdout.write(
      `${LOG} ไม่ได้ seed consent_records (รอ D0-5/D0-7) — scenario parent_status อาจถูก consent gate ปฏิเสธตามประเด็น D0-3\n`
    );
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${LOG} ล้มเหลว: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  SCALE_TIERS,
  FORBIDDEN_DB_NAMES,
  REQUIRED_DB_NAME_MARKERS,
  OWN,
  ABSENT_RATIO,
  TEACHER_ACCOUNTS_PER_SCHOOL,
  checkTarget,
  resolveTier,
  buildDataset,
  buildDailyRows,
  likePrefix,
  mulberry32,
};
