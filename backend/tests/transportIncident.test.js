'use strict';

const { getTestConnection } = require('./dbHelper');
const { getIncidentVehicle } = require('../src/services/transportIncident.service');
const { todayBangkok } = require('../src/utils/thaiTime');

test('incident SQL isolates vehicle/session, excludes deleted pupils, and separates current assignment from event history', async () => {
  const conn = await getTestConnection();
  try {
    await conn.beginTransaction();
    await conn.query("INSERT INTO schools (id, name) VALUES ('TINC21', 'โรงเรียนจำลองเหตุ')");
    await conn.query(`INSERT INTO vehicles (id, plate_no, normalized_plate)
      VALUES ('V-incident21a', '__TEST INCIDENT 21A', '__testincident21a'),
             ('V-incident21b', '__TEST INCIDENT 21B', '__testincident21b')`);
    await conn.query(`INSERT INTO students (id, cid_hash, first_name, last_name, school_id, vehicle_id, is_deleted, dropoff_address)
      VALUES (99002101, SHA2('incident-one',256), 'จำลองหนึ่ง', 'ทดสอบ', 'TINC21', 'V-incident21a', FALSE, 'DO_NOT_DISCLOSE'),
             (99002102, SHA2('incident-two',256), 'จำลองสอง', 'ทดสอบ', 'TINC21', 'V-incident21b', FALSE, NULL),
             (99002103, SHA2('incident-deleted',256), 'DELETED_PUPIL', 'ทดสอบ', 'TINC21', 'V-incident21a', TRUE, NULL)`);
    await conn.query(`INSERT INTO checkin_logs (vehicle_id, student_id, student_name, session, status, check_date)
      VALUES ('V-incident21a',99002101,'จำลองหนึ่ง','morning','CHECKED_IN',CURDATE()),
             ('V-incident21a',99002101,'จำลองหนึ่ง','morning','CANCELLED',CURDATE()),
             ('V-incident21a',99002102,'จำลองสองย้ายรถแล้ว','morning','CHECKED_OUT',CURDATE()),
             ('V-incident21b',99002102,'OTHER_VEHICLE','morning','CHECKED_IN',CURDATE()),
             ('V-incident21a',99002101,'OTHER_SESSION','evening','CHECKED_IN',CURDATE()),
             ('V-incident21a',99002103,'DELETED_PUPIL','morning','CHECKED_IN',CURDATE())`);
    const data = await getIncidentVehicle({ vehicleId: 'V-incident21a', date: todayBangkok(), session: 'morning', role: 'transport' }, conn);
    expect(data.current_roster.map(row => row.id)).toEqual([99002101]);
    expect(data.recorded_events.map(row => row.status)).toEqual(['CHECKED_IN', 'CANCELLED', 'CHECKED_OUT']);
    expect(data.recorded_events[2].name).toBe('จำลองสองย้ายรถแล้ว');
    expect(JSON.stringify(data)).not.toMatch(/DO_NOT_DISCLOSE|OTHER_VEHICLE|OTHER_SESSION|DELETED_PUPIL|cid_hash/);
    const evening = await getIncidentVehicle({ vehicleId: 'V-incident21a', date: todayBangkok(), session: 'evening', role: 'transport' }, conn);
    expect(evening.recorded_events).toHaveLength(1);
    await conn.query("UPDATE vehicles SET is_deleted=TRUE WHERE id='V-incident21a'");
    await expect(getIncidentVehicle({ vehicleId: 'V-incident21a', date: todayBangkok(), session: 'morning', role: 'transport' }, conn)).rejects.toMatchObject({ statusCode: 404 });
  } finally {
    await conn.rollback();
    await conn.end();
  }
});
