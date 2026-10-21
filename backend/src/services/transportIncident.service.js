'use strict';

const { pool } = require('../config/database');
const { todayBangkok, daysBetweenBangkok } = require('../utils/thaiTime');

function invalid(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function validateSelection({ vehicleId, date, session }, today = todayBangkok()) {
  if (typeof vehicleId !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(vehicleId)) {
    throw invalid('รหัสรถไม่ถูกต้อง');
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
      || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw invalid('วันที่ไม่ถูกต้อง');
  }
  const age = daysBetweenBangkok(date, today);
  if (age < 0 || age > 30) throw invalid('เลือกวันที่วันนี้หรือย้อนหลังได้ไม่เกิน 30 วัน');
  if (!['morning', 'evening'].includes(session)) throw invalid('กรุณาเลือกรอบเช้าหรือรอบเย็น');
}

/** Dedicated, owner-authorized incident view. The ordinary vehicle lists and
 * CSV keep their existing pupil-free contract. Never infer occupancy from
 * assignment or daily_status: show the actual event ledger, including voids.
 * School and pickup assignments are CURRENT master data, not historical proof.
 */
async function getIncidentVehicle({ vehicleId, date, session, role }, db = pool) {
  if (!['transport', 'admin'].includes(role)) throw invalid('ไม่มีสิทธิ์เปิดข้อมูลนี้', 403);
  validateSelection({ vehicleId, date, session });
  const [[vehicle]] = await db.query(
    `SELECT v.id, v.plate_no, v.vehicle_type, v.certified_capacity,
            v.verification_status,
            (SELECT JSON_ARRAYAGG(d.name) FROM driver_vehicle_assignments dva
               JOIN drivers d ON d.id = dva.driver_id AND d.is_deleted = FALSE
              WHERE dva.vehicle_id = v.id AND dva.is_active = TRUE
                AND dva.authorization_status = 'AUTHORIZED'
                AND dva.start_date <= CURDATE()
                AND (dva.end_date IS NULL OR dva.end_date >= CURDATE())
                AND (dva.valid_from IS NULL OR dva.valid_from <= CURDATE())
                AND (dva.valid_until IS NULL OR dva.valid_until >= CURDATE())) AS driver_names
       FROM vehicles v WHERE v.id = ? AND v.is_deleted = FALSE`, [vehicleId],
  );
  if (!vehicle) throw invalid('ไม่พบรถคันนี้ในระบบ', 404);
  let driverNames = vehicle.driver_names;
  if (typeof driverNames === 'string') driverNames = JSON.parse(driverNames);
  if (!Array.isArray(driverNames)) driverNames = [];

  const [assigned] = await db.query(
    `SELECT s.id, s.prefix, s.first_name, s.last_name,
            sc.name AS school_name, s.updated_at
       FROM students s
       JOIN schools sc ON sc.id = s.school_id AND sc.is_deleted = FALSE
      WHERE s.vehicle_id = ? AND s.is_deleted = FALSE
        AND ((? = 'morning' AND s.morning_enabled = TRUE)
          OR (? = 'evening' AND s.evening_enabled = TRUE))
      ORDER BY sc.name, s.first_name, s.last_name, s.id`, [vehicleId, session, session],
  );
  const [points] = await db.query(
    `SELECT s.id AS student_id, pp.label
       FROM students s
       JOIN student_pickup_points spp ON spp.student_id = s.id
       JOIN pickup_points pp ON pp.id = spp.pickup_point_id
       JOIN schools sc ON sc.id = s.school_id AND sc.is_deleted = FALSE
      WHERE s.vehicle_id = ? AND s.is_deleted = FALSE
        AND pp.vehicle_id = ? AND pp.is_deleted = FALSE
        AND pp.session IN (?, 'both')
        AND (spp.term_id IS NULL OR spp.term_id = s.term_id)
      ORDER BY pp.sequence, pp.id`, [vehicleId, vehicleId, session],
  );
  const [logs] = await db.query(
    `SELECT cl.id, cl.student_id, cl.student_name, cl.status, cl.checked_at,
            sc.name AS school_name
       FROM checkin_logs cl
       JOIN students s ON s.id = cl.student_id AND s.is_deleted = FALSE
       LEFT JOIN schools sc ON sc.id = s.school_id AND sc.is_deleted = FALSE
      WHERE cl.vehicle_id = ? AND cl.check_date = ? AND cl.session = ?
      ORDER BY cl.id ASC`, [vehicleId, date, session],
  );
  const byStudent = new Map();
  for (const point of points) {
    if (!byStudent.has(point.student_id)) byStudent.set(point.student_id, []);
    byStudent.get(point.student_id).push(point.label);
  }
  // Explicit output allowlists: no cid/hash, parent contact, home address,
  // free-text notes, GPS, author identity or other-vehicle event is disclosed.
  return {
    vehicle: {
      id: vehicle.id, plate_no: vehicle.plate_no, vehicle_type: vehicle.vehicle_type,
      certified_capacity: vehicle.certified_capacity,
      verification_status: vehicle.verification_status, driver_names: driverNames.filter(name => typeof name === 'string'),
    },
    date, session, fetched_at: new Date().toISOString(),
    current_roster: assigned.map(s => ({
      id: s.id, name: `${s.prefix || ''}${s.first_name} ${s.last_name}`.trim(),
      school_name: s.school_name, updated_at: s.updated_at,
      pickup_points: byStudent.get(s.id) || [],
    })),
    recorded_events: logs.map(log => ({
      id: log.id, name: log.student_name || 'ไม่พบชื่อในบันทึก',
      school_name: log.school_name || null, status: log.status, checked_at: log.checked_at,
    })),
  };
}

module.exports = { validateSelection, getIncidentVehicle };
