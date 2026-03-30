'use strict';

/**
 * migrate-from-excel.js
 *
 * Reads  input/Lampang_Bus_System_MasterV.1.xlsx
 * and migrates all legacy data into MySQL.
 *
 * Sheets processed:
 *  - DATA          → affiliations, schools, vehicles, drivers,
 *                    driver_vehicle_assignments, vehicle_attendants,
 *                    students, parents, parent_student
 *  - USERS         → users (passwords bcrypt-hashed)
 *  - Log_YYYY_MM   → checkin_logs (all matching sheets)
 *  - EMERGENCY_LOG → emergency_logs
 *  - PARAM         → system_params
 *
 * Run ONLY after the database schema has been created:
 *   mysql -u <user> -p <db> < backend/migrations/001_initial_schema.sql
 *   node backend/scripts/migrate-from-excel.js
 */

require('dotenv').config();
const path = require('path');
const ExcelJS = require('exceljs');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const { hashCid, generateVehicleId } = require('../src/utils/hash');

const EXCEL_PATH = path.resolve(__dirname, '../../input/Lampang_Bus_System_MasterV.1.xlsx');
const BCRYPT_COST = 12;
const CURRENT_TERM = process.env.CURRENT_TERM || '2568-2';

// ─── DB connection ────────────────────────────────────────────────────────────

async function createPool() {
  return mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    database: process.env.DB_NAME || 'lampang_bus',
    user: process.env.DB_USER || 'lampang',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
    timezone: '+07:00',
    waitForConnections: true,
    connectionLimit: 5,
  });
}

// ─── Excel helpers ────────────────────────────────────────────────────────────

function cellValue(row, colIndex) {
  const cell = row.getCell(colIndex);
  if (cell.value === null || cell.value === undefined) return null;
  if (typeof cell.value === 'object' && cell.value.richText) {
    return cell.value.richText.map((r) => r.text).join('').trim() || null;
  }
  if (typeof cell.value === 'object' && cell.value instanceof Date) {
    return cell.value;
  }
  return String(cell.value).trim() || null;
}

function yesNo(val) {
  if (!val) return false;
  return String(val).trim().toUpperCase() === 'Y';
}

function toDateString(val) {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().split('T')[0];
  }
  const s = String(val).trim();
  if (!s) return null;
  // Try parsing Thai date or ISO date
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

// ─── Migrate PARAM → system_params ───────────────────────────────────────────

async function migrateParams(worksheet, pool) {
  console.log('\n[PARAM] Migrating system parameters...');
  let count = 0;

  for (let r = 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const key = cellValue(row, 1);
    const value = cellValue(row, 2);
    if (!key) continue;

    await pool.query(
      `INSERT INTO system_params (param_key, param_value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE param_value = VALUES(param_value)`,
      [key, value]
    );
    count++;
  }
  console.log(`[PARAM] ${count} params inserted/updated`);
}

// ─── Migrate DATA sheet ───────────────────────────────────────────────────────
//
// Column mapping (1-indexed):
//  1  A  รหัสโรงเรียน
//  2  B  โรงเรียน
//  3  C  หน่วยงาน (AFF ID)
//  4  D  ชื่อหน่วยงาน
//  5  E  รหัสนักเรียน
//  6  F  เลขบัตรประชาชน (13 หลัก)
//  7  G  คำนำหน้า
//  8  H  ชื่อ
//  9  I  นามสกุล
// 10  J  ระดับชั้น
// 11  K  ห้อง
// 12  L  ใช้บริการรอบเช้า (Y/N)
// 13  M  ใช้บริการรอบเย็น (Y/N)
// 14  N  ชื่อผู้ปกครอง
// 15  O  เบอร์โทรผู้ปกครอง
// 16  P  จุดลงรถ/ที่อยู่
// 17  Q  ทะเบียนรถรับส่ง
// 18  R  ประเภทรถ
// 19  S  ชื่อคนขับรถ
// 20  T  เบอร์โทรคนขับ
// 21  U  ชื่อผู้ดูแลรถ
// 22  V  เบอร์โทรผู้ดูแลรถ
// 23  W  ชื่อผู้ครอบครองรถ
// 24  X  เบอร์โทรผู้ครอบครอง
// 25  Y  สถานะประกันภัย
// 26  Z  ประเภทประกัน
// 27  AA วันหมดอายุประกัน

async function migrateData(worksheet, pool) {
  console.log('\n[DATA] Migrating main data...');

  const affiliationMap = new Map(); // affId → name (dedup)
  const schoolMap      = new Map(); // schoolId → { name, affId }
  const vehicleMap     = new Map(); // plateNo → vehicleId
  const driverMap      = new Map(); // name+phone → driverId
  const attendantSet   = new Set(); // vehicleId+name (dedup)

  const affiliations    = [];
  const schools         = [];
  const vehicles        = [];
  const drivers         = [];
  const assignments     = [];
  const attendants      = [];
  const students        = [];
  const parents         = [];
  const parentStudents  = [];

  // Skip header row
  const firstRow = worksheet.getRow(1);
  const firstCell = cellValue(firstRow, 1);
  const startRow = (firstCell && isNaN(Number(firstCell))) ? 2 : 1;

  for (let r = startRow; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const schoolId  = cellValue(row, 1);
    const studentId = cellValue(row, 5);
    if (!schoolId || !studentId) continue;

    // Affiliations
    const affId   = cellValue(row, 3);
    const affName = cellValue(row, 4);
    if (affId && !affiliationMap.has(affId)) {
      affiliationMap.set(affId, affName);
      affiliations.push({ id: affId, name: affName || '' });
    }

    // Schools
    if (!schoolMap.has(schoolId)) {
      schoolMap.set(schoolId, true);
      schools.push({ id: schoolId, name: cellValue(row, 2) || '', affiliation_id: affId });
    }

    // Vehicles
    const plateNo = cellValue(row, 17);
    let vehicleId = null;
    if (plateNo) {
      if (!vehicleMap.has(plateNo)) {
        vehicleId = generateVehicleId(plateNo);
        vehicleMap.set(plateNo, vehicleId);
        vehicles.push({
          id:               vehicleId,
          plate_no:         plateNo,
          vehicle_type:     cellValue(row, 18),
          owner_name:       cellValue(row, 23),
          owner_phone:      cellValue(row, 24),
          insurance_status: cellValue(row, 25),
          insurance_type:   cellValue(row, 26),
          insurance_expiry: toDateString(cellValue(row, 27)),
        });

        // Driver for this vehicle
        const driverName  = cellValue(row, 19);
        const driverPhone = cellValue(row, 20);
        if (driverName) {
          const driverKey = `${driverName}||${driverPhone || ''}`;
          if (!driverMap.has(driverKey)) {
            driverMap.set(driverKey, driverMap.size + 1); // placeholder, real id set after insert
            drivers.push({ name: driverName, phone: driverPhone, _key: driverKey, _vehicleId: vehicleId });
          } else {
            // Existing driver assigned to another vehicle
            assignments.push({ _driverKey: driverKey, vehicle_id: vehicleId });
          }
        }

        // Attendant
        const attendantName  = cellValue(row, 21);
        const attendantPhone = cellValue(row, 22);
        if (attendantName) {
          const aKey = `${vehicleId}||${attendantName}`;
          if (!attendantSet.has(aKey)) {
            attendantSet.add(aKey);
            attendants.push({ vehicle_id: vehicleId, name: attendantName, phone: attendantPhone });
          }
        }
      } else {
        vehicleId = vehicleMap.get(plateNo);
      }
    }

    // Students
    const cid = cellValue(row, 6);
    students.push({
      id:              parseInt(studentId, 10),
      cid_hash:        cid ? hashCid(String(cid)) : hashCid(`NOID-${studentId}`),
      prefix:          cellValue(row, 7),
      first_name:      cellValue(row, 8) || '',
      last_name:       cellValue(row, 9) || '',
      grade:           cellValue(row, 10),
      classroom:       cellValue(row, 11),
      school_id:       schoolId,
      vehicle_id:      vehicleId,
      dropoff_address: cellValue(row, 16),
      morning_enabled: yesNo(cellValue(row, 12)),
      evening_enabled: yesNo(cellValue(row, 13)),
      term_id:         CURRENT_TERM,
    });

    // Parents
    const parentName  = cellValue(row, 14);
    const parentPhone = cellValue(row, 15);
    if (parentName) {
      parents.push({ name: parentName, phone: parentPhone, _studentId: parseInt(studentId, 10) });
    }
  }

  // ── Insert affiliations ──
  console.log(`  [affiliations] ${affiliations.length} records`);
  for (const a of affiliations) {
    await pool.query(
      `INSERT INTO affiliations (id, name) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [a.id, a.name]
    );
  }

  // ── Insert schools ──
  console.log(`  [schools] ${schools.length} records`);
  for (const s of schools) {
    await pool.query(
      `INSERT INTO schools (id, name, affiliation_id) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [s.id, s.name, s.affiliation_id]
    );
  }

  // ── Insert vehicles ──
  console.log(`  [vehicles] ${vehicles.length} records`);
  for (const v of vehicles) {
    await pool.query(
      `INSERT INTO vehicles (id, plate_no, vehicle_type, owner_name, owner_phone,
                             insurance_status, insurance_type, insurance_expiry)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         vehicle_type     = VALUES(vehicle_type),
         owner_name       = VALUES(owner_name),
         owner_phone      = VALUES(owner_phone),
         insurance_status = VALUES(insurance_status),
         insurance_type   = VALUES(insurance_type),
         insurance_expiry = VALUES(insurance_expiry)`,
      [v.id, v.plate_no, v.vehicle_type, v.owner_name, v.owner_phone,
       v.insurance_status, v.insurance_type, v.insurance_expiry]
    );
  }

  // ── Insert drivers ──
  console.log(`  [drivers] ${drivers.length} records`);
  const driverIdMap = new Map(); // driverKey → real DB id
  for (const d of drivers) {
    const [result] = await pool.query(
      `INSERT INTO drivers (name, phone)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE phone = VALUES(phone)`,
      [d.name, d.phone]
    );
    let realId = result.insertId;
    if (realId === 0) {
      // Duplicate — fetch existing id
      const [rows] = await pool.query(
        'SELECT id FROM drivers WHERE name = ? AND (phone = ? OR phone IS NULL) LIMIT 1',
        [d.name, d.phone]
      );
      realId = rows[0]?.id;
    }
    driverIdMap.set(d._key, realId);

    // Primary assignment (first vehicle seen for this driver)
    await pool.query(
      `INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, term_id, start_date, is_active)
       VALUES (?, ?, ?, CURDATE(), TRUE)
       ON DUPLICATE KEY UPDATE is_active = TRUE`,
      [realId, d._vehicleId, CURRENT_TERM]
    );
  }

  // Extra assignments (same driver, different vehicle)
  for (const a of assignments) {
    const driverId = driverIdMap.get(a._driverKey);
    if (driverId) {
      await pool.query(
        `INSERT IGNORE INTO driver_vehicle_assignments (driver_id, vehicle_id, term_id, start_date, is_active)
         VALUES (?, ?, ?, CURDATE(), TRUE)`,
        [driverId, a.vehicle_id, CURRENT_TERM]
      );
    }
  }

  // ── Insert attendants ──
  console.log(`  [vehicle_attendants] ${attendants.length} records`);
  for (const a of attendants) {
    await pool.query(
      'INSERT IGNORE INTO vehicle_attendants (vehicle_id, name, phone) VALUES (?, ?, ?)',
      [a.vehicle_id, a.name, a.phone]
    );
  }

  // ── Insert students ──
  console.log(`  [students] ${students.length} records`);
  for (const s of students) {
    await pool.query(
      `INSERT INTO students
         (id, cid_hash, prefix, first_name, last_name, grade, classroom,
          school_id, vehicle_id, dropoff_address, morning_enabled, evening_enabled, term_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         cid_hash        = VALUES(cid_hash),
         prefix          = VALUES(prefix),
         first_name      = VALUES(first_name),
         last_name       = VALUES(last_name),
         grade           = VALUES(grade),
         classroom       = VALUES(classroom),
         school_id       = VALUES(school_id),
         vehicle_id      = VALUES(vehicle_id),
         dropoff_address = VALUES(dropoff_address),
         morning_enabled = VALUES(morning_enabled),
         evening_enabled = VALUES(evening_enabled),
         term_id         = VALUES(term_id)`,
      [s.id, s.cid_hash, s.prefix, s.first_name, s.last_name, s.grade, s.classroom,
       s.school_id, s.vehicle_id, s.dropoff_address, s.morning_enabled, s.evening_enabled, s.term_id]
    );
  }

  // ── Insert parents ──
  console.log(`  [parents] ${parents.length} records`);
  for (const p of parents) {
    const [result] = await pool.query(
      `INSERT INTO parents (name, phone) VALUES (?, ?)`,
      [p.name, p.phone]
    );
    if (result.insertId && p._studentId) {
      await pool.query(
        `INSERT IGNORE INTO parent_student (parent_id, student_id, approved)
         VALUES (?, ?, TRUE)`,
        [result.insertId, p._studentId]
      );
    }
  }

  console.log('[DATA] Done');
}

// ─── Migrate USERS sheet ──────────────────────────────────────────────────────

async function migrateUsers(worksheet, pool) {
  console.log('\n[USERS] Migrating users...');
  let count = 0;

  // Detect header row
  const firstRow = worksheet.getRow(1);
  const firstCell = cellValue(firstRow, 1);
  const startRow = (firstCell && firstCell.toLowerCase().includes('user')) ? 2 : 1;

  for (let r = startRow; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const username   = cellValue(row, 1);
    const password   = cellValue(row, 2) || '1234';
    const role       = cellValue(row, 3);
    const scopeType  = cellValue(row, 4);
    const scopeId    = cellValue(row, 5);

    if (!username || !role) continue;

    const validRoles = ['driver','school','affiliation','province','transport','admin'];
    if (!validRoles.includes(role)) {
      console.warn(`  [USERS] Skipping unknown role '${role}' for user '${username}'`);
      continue;
    }

    const passwordHash = await bcrypt.hash(String(password), BCRYPT_COST);

    await pool.query(
      `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         password_hash = VALUES(password_hash),
         role          = VALUES(role),
         scope_type    = VALUES(scope_type),
         scope_id      = VALUES(scope_id)`,
      [username, passwordHash, role, scopeType || null, scopeId || null, username]
    );
    count++;
  }
  console.log(`[USERS] ${count} users inserted/updated`);
}

// ─── Migrate Log_YYYY_MM sheets ───────────────────────────────────────────────
//
// Log entry columns (1-indexed):
//  1  timestamp
//  2  term_id
//  3  plate_no
//  4  vehicle_id
//  5  cid_hash
//  6  student_name
//  7  student_school_id
//  8  session   (morning / evening)
//  9  status    (รับแล้ว / ส่งแล้ว)
// 10  date

const STATUS_MAP = {
  'รับแล้ว': 'CHECKED_IN',
  'ส่งแล้ว': 'CHECKED_OUT',
  'ไม่มา':   'ABSENT',
  'ยกเลิก':  'CANCELLED',
};

async function migrateLogSheet(worksheet, pool) {
  let count = 0;

  const firstRow = worksheet.getRow(1);
  const firstCell = cellValue(firstRow, 1);
  const startRow = (firstCell && (firstCell.toLowerCase().includes('time') || firstCell.toLowerCase().includes('วัน'))) ? 2 : 1;

  for (let r = startRow; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const tsRaw      = cellValue(row, 1);
    const termId     = cellValue(row, 2);
    const plateNo    = cellValue(row, 3);
    const vehicleId  = cellValue(row, 4);
    const cidHash    = cellValue(row, 5);
    const studentName= cellValue(row, 6);
    const session    = cellValue(row, 8);
    const statusRaw  = cellValue(row, 9);
    const dateRaw    = cellValue(row, 10);

    if (!tsRaw && !dateRaw) continue;

    const status = STATUS_MAP[statusRaw] || statusRaw;
    const validStatuses = ['CHECKED_IN','CHECKED_OUT','ABSENT','CANCELLED'];
    if (!validStatuses.includes(status)) continue;

    const checkDate = toDateString(dateRaw || tsRaw);
    if (!checkDate) continue;

    // Find student_id by vehicle + cid_hash
    let studentId = null;
    if (cidHash) {
      const [rows] = await pool.query(
        'SELECT id FROM students WHERE cid_hash = ? LIMIT 1',
        [cidHash]
      );
      if (rows.length > 0) studentId = rows[0].id;
    }

    // Find vehicle_id from plate or use stored id
    let resolvedVehicleId = vehicleId;
    if (!resolvedVehicleId && plateNo) {
      const [rows] = await pool.query(
        'SELECT id FROM vehicles WHERE plate_no = ? LIMIT 1',
        [plateNo]
      );
      if (rows.length > 0) resolvedVehicleId = rows[0].id;
    }

    try {
      await pool.query(
        `INSERT INTO checkin_logs
           (term_id, vehicle_id, plate_no, student_id, cid_hash,
            student_name, session, status, check_date, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto')`,
        [termId, resolvedVehicleId, plateNo, studentId, cidHash,
         studentName, session, status, checkDate]
      );
      count++;
    } catch {
      // Skip rows that violate FK constraints (orphan data)
    }
  }
  return count;
}

// ─── Migrate EMERGENCY_LOG ────────────────────────────────────────────────────

async function migrateEmergencyLog(worksheet, pool) {
  console.log('\n[EMERGENCY_LOG] Migrating emergency logs...');
  let count = 0;

  const firstRow = worksheet.getRow(1);
  const firstCell = cellValue(firstRow, 1);
  const startRow = (firstCell && !firstCell.match(/^\d/)) ? 2 : 1;

  for (let r = startRow; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    const tsRaw   = cellValue(row, 1);
    const plateNo = cellValue(row, 2);
    const detail  = cellValue(row, 3);
    const note    = cellValue(row, 4);
    const result  = cellValue(row, 5);

    if (!tsRaw && !plateNo) continue;

    let vehicleId = null;
    if (plateNo) {
      const [rows] = await pool.query(
        'SELECT id FROM vehicles WHERE plate_no = ? LIMIT 1',
        [plateNo]
      );
      if (rows.length > 0) vehicleId = rows[0].id;
    }

    await pool.query(
      `INSERT INTO emergency_logs (channel, vehicle_id, plate_no, detail, note, result, reported_at)
       VALUES ('web', ?, ?, ?, ?, ?, ?)`,
      [vehicleId, plateNo, detail, note, result, tsRaw instanceof Date ? tsRaw : new Date()]
    );
    count++;
  }
  console.log(`[EMERGENCY_LOG] ${count} records`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Lampang Bus System — Excel Migration');
  console.log(`Source: ${EXCEL_PATH}`);
  console.log('='.repeat(60));

  const pool = await createPool();

  // Verify DB connection
  await pool.query('SELECT 1');
  console.log('[db] Connected');

  // Load workbook (read only for speed, shared strings loaded)
  const workbook = new ExcelJS.Workbook();
  workbook.xlsx.readFile.bind(workbook);

  console.log('\nLoading workbook (this may take a moment)...');
  await workbook.xlsx.readFile(EXCEL_PATH);
  console.log(`Workbook loaded. Sheets: ${workbook.worksheets.map((w) => w.name).join(', ')}`);

  // ── PARAM ──
  const paramSheet = workbook.getWorksheet('PARAM');
  if (paramSheet) await migrateParams(paramSheet, pool);
  else console.warn('[PARAM] Sheet not found — skipping');

  // ── DATA ──
  const dataSheet = workbook.getWorksheet('DATA');
  if (dataSheet) await migrateData(dataSheet, pool);
  else console.error('[DATA] Sheet not found — critical, aborting');

  // ── USERS ──
  const usersSheet = workbook.getWorksheet('USERS');
  if (usersSheet) await migrateUsers(usersSheet, pool);
  else console.warn('[USERS] Sheet not found — skipping');

  // ── Log_YYYY_MM (discover all matching sheets) ──
  const logSheets = workbook.worksheets.filter((ws) => /^Log_\d{4}_\d{2}$/i.test(ws.name));
  console.log(`\n[LOGS] Found ${logSheets.length} log sheet(s): ${logSheets.map((w) => w.name).join(', ')}`);
  let totalLogs = 0;
  for (const ws of logSheets) {
    const n = await migrateLogSheet(ws, pool);
    console.log(`  [${ws.name}] ${n} records`);
    totalLogs += n;
  }
  console.log(`[LOGS] Total: ${totalLogs} checkin records`);

  // ── EMERGENCY_LOG ──
  const emergencySheet = workbook.getWorksheet('EMERGENCY_LOG');
  if (emergencySheet) await migrateEmergencyLog(emergencySheet, pool);
  else console.warn('[EMERGENCY_LOG] Sheet not found — skipping');

  await pool.end();
  console.log('\n' + '='.repeat(60));
  console.log('Migration complete.');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('\n[FATAL]', err.message);
  console.error(err.stack);
  process.exit(1);
});
