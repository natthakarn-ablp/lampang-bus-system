'use strict';

// Disposable database only. The fixture deliberately has a newer legacy
// PASSED row than its finalized shared FAILED attempt; certification and every
// transport read/export must still use the finalized shared result.
require('./loadTestEnv');
const { getTestConnection } = require('./dbHelper');
const { todayBangkok } = require('../src/utils/thaiTime');
const transport = require('../src/services/transport.service');

const VEHICLE = 'V-canonfixture1';
const PLATE = '__CANON 0001';
const USERNAME = '__canon_transport';
const TEMPLATE = '__CANON_TEMPLATE';
const REQUEST = '__CANON_REQ_1';
let userId;
let legacyId;

async function cleanup(conn) {
  await conn.query('DELETE ia FROM inspection_attempts ia JOIN vehicle_inspection_applications a ON a.id = ia.application_id WHERE a.request_no = ?', [REQUEST]);
  await conn.query('DELETE FROM vehicle_inspection_applications WHERE request_no = ?', [REQUEST]);
  await conn.query('DELETE FROM vehicle_inspections WHERE vehicle_id = ?', [VEHICLE]);
  await conn.query('DELETE FROM vehicles WHERE id = ?', [VEHICLE]);
  await conn.query('DELETE FROM inspection_checklist_templates WHERE template_code = ?', [TEMPLATE]);
  await conn.query('DELETE FROM users WHERE username = ?', [USERNAME]);
}

beforeAll(async () => {
  const conn = await getTestConnection();
  try {
    await cleanup(conn);
    const [user] = await conn.query(
      `INSERT INTO users (username, password_hash, role, display_name)
       VALUES (?, 'fixture-only-no-login', 'transport', '__Canon Transport')`, [USERNAME]
    );
    userId = user.insertId;
    await conn.query(
      `INSERT INTO vehicles (id, plate_no, normalized_plate, canonical_plate, vehicle_type,
         insurance_expiry, registration_expiry, compulsory_insurance_expiry, tax_expiry,
         verification_status)
       VALUES (?, ?, '__canon0001', '__canon0001', 'van',
         DATE_ADD(CURDATE(), INTERVAL 100 DAY), DATE_ADD(CURDATE(), INTERVAL 100 DAY),
         DATE_ADD(CURDATE(), INTERVAL 100 DAY), DATE_ADD(CURDATE(), INTERVAL 100 DAY), 'ELIGIBLE')`,
      [VEHICLE, PLATE]
    );
    const [template] = await conn.query(
      `INSERT INTO inspection_checklist_templates (template_code, template_name, version_no)
       VALUES (?, 'Synthetic transport canonical test', 1)`, [TEMPLATE]
    );
    const [app] = await conn.query(
      `INSERT INTO vehicle_inspection_applications
       (request_no, vehicle_id, issuing_school_id, requested_by, current_term,
        status, qr_token, vehicle_snapshot_json, rider_summary_json)
       VALUES (?, ?, '__TSCH', ?, '2569-2', 'FAILED', '__canon-token-20261017', '{}', '{}')`,
      [REQUEST, VEHICLE, userId]
    );
    await conn.query(
      `INSERT INTO inspection_attempts
       (application_id, checklist_template_id, inspected_by, result, inspection_date, finalized_at)
       VALUES (?, ?, ?, 'FAILED', DATE_SUB(CURDATE(), INTERVAL 2 DAY), CURRENT_TIMESTAMP)`,
      [app.insertId, template.insertId, userId]
    );
    const [legacy] = await conn.query(
      `INSERT INTO vehicle_inspections
       (vehicle_id, inspected_by, inspection_date, expiry_date, result)
       VALUES (?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL 100 DAY), 'PASSED')`,
      [VEHICLE, userId]
    );
    legacyId = legacy.insertId;
  } finally { await conn.end(); }
});

afterAll(async () => {
  const conn = await getTestConnection();
  try { await cleanup(conn); } finally { await conn.end(); }
});

test('list and export prefer shared final result and flag the conflicting legacy row', async () => {
  const { vehicles } = await transport.getVehicles({ search: PLATE, per_page: 10 });
  expect(vehicles).toHaveLength(1);
  expect(vehicles[0]).toMatchObject({
    latest_inspection_result: 'FAILED', inspection_expiry: null,
    inspection_conflict: 1, has_shared_inspection: 1,
  });
  const exported = (await transport.getSafetyExportRows()).find(row => row.plate_no === PLATE);
  expect(exported.latest_inspection_result).toBe('FAILED');
  expect(exported.inspection_expiry).toBeNull();
  const dashboard = await transport.getDashboard();
  expect(dashboard.inspection_conflict_count).toBeGreaterThanOrEqual(1);
});

test('legacy create, update and delete cannot change a finalized shared result', async () => {
  await expect(transport.createInspection({
    vehicleId: VEHICLE, inspectionDate: todayBangkok(), result: 'FAILED', userId,
  })).rejects.toMatchObject({ statusCode: 409 });
  await expect(transport.updateInspection({
    inspectionId: legacyId, result: 'FAILED', userId,
  })).rejects.toMatchObject({ statusCode: 409 });
  await expect(transport.deleteInspection({ inspectionId: legacyId, userId }))
    .rejects.toMatchObject({ statusCode: 409 });
  const conn = await getTestConnection();
  try {
    const [[{ count }]] = await conn.query('SELECT COUNT(*) AS count FROM vehicle_inspections WHERE id = ?', [legacyId]);
    expect(count).toBe(1);
  } finally { await conn.end(); }
});
