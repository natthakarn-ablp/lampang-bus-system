'use strict';

/**
 * The transport read path must emit DATE columns as Bangkok calendar dates.
 *
 * CS5-02 fixed this for `school.service.getVehicles()`. The verifier then
 * measured `GET /api/transport/vehicles` on the sandbox and found 196
 * instant-shaped date values across 50 rows — every `insurance_expiry`,
 * `registration_expiry`, `compulsory_insurance_expiry` and `tax_expiry`
 * arriving as `2026-08-04T17:00:00.000Z` for the stored `2026-08-05`.
 *
 * Why that matters even though no transport screen writes these values back:
 *
 *   - `TransportVehicleList.jsx` prints `v.insurance_expiry` and
 *     `v.latest_inspection_date` straight into the table, so the operator was
 *     shown a raw ISO instant instead of a date.
 *   - the same rows are the source for anything that takes the first ten
 *     characters, which is the previous day. That is exactly the chain that
 *     corrupted the school edit form, one save at a time.
 *
 * The dates below are deliberately far in the past and all different, so the
 * assertions never depend on when the suite runs and a swapped column is
 * visible in the failure message.
 */

require('dotenv').config();
const request = require('supertest');
const bcrypt = require('bcrypt');
const { getTestConnection } = require('./dbHelper');
const app = require('../src/app');
const transportSvc = require('../src/services/transport.service');

const TRANSPORT = { username: '__test_transport', password: 'testpass123' };

// Two fixtures: one that has an inspection (so `latest_inspection_date` and
// `inspection_expiry` are non-null and it is NOT in the pending list), and one
// with no inspection at all (so it IS in the pending list).
const INSPECTED = {
  id: 'V-testdate001',
  plate: '__TEST DATE 0001',
  normalized: '__testdate0001',
};
const UNINSPECTED = {
  id: 'V-testdate002',
  plate: '__TEST DATE 0002',
  normalized: '__testdate0002',
};

const DOC_DATES = {
  insurance_expiry: '2020-01-15',
  registration_expiry: '2020-02-16',
  compulsory_insurance_expiry: '2020-03-17',
  tax_expiry: '2020-04-18',
};
const INSPECTION_DATE = '2020-05-19';
const INSPECTION_EXPIRY = '2021-05-19';

/** Every DATE column the transport vehicle payload carries. */
const VEHICLE_DATE_FIELDS = [
  ...Object.keys(DOC_DATES),
  'latest_inspection_date',
  'inspection_expiry',
];

/** The instant shape mysql2 produces for a DATE on a +07:00 connection. */
const INSTANT_SHAPE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * What a client does with these values today. `TransportVehicleList.jsx`
 * prints them; `VehicleList.jsx` (school) slices ten characters off them. The
 * slice is the destructive reading, so it is the one asserted on.
 */
function tenCharacterPrefix(apiValue) {
  return apiValue ? String(apiValue).slice(0, 10) : '';
}

let token = '';
let transportUserId = null;

async function seed(conn) {
  const hash = await bcrypt.hash(TRANSPORT.password, 12);
  await conn.query(
    `INSERT INTO users (username, password_hash, role, scope_type, scope_id, display_name)
     VALUES (?, ?, 'transport', NULL, NULL, '__transport test')
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), is_active = TRUE`,
    [TRANSPORT.username, hash]
  );
  const [[user]] = await conn.query('SELECT id FROM users WHERE username = ?', [TRANSPORT.username]);
  transportUserId = user.id;

  for (const v of [INSPECTED, UNINSPECTED]) {
    await conn.query(
      `INSERT INTO vehicles
         (id, plate_no, normalized_plate, vehicle_type,
          insurance_expiry, registration_expiry, compulsory_insurance_expiry, tax_expiry)
       VALUES (?, ?, ?, 'van', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         insurance_expiry            = VALUES(insurance_expiry),
         registration_expiry         = VALUES(registration_expiry),
         compulsory_insurance_expiry = VALUES(compulsory_insurance_expiry),
         tax_expiry                  = VALUES(tax_expiry)`,
      [v.id, v.plate, v.normalized,
        DOC_DATES.insurance_expiry, DOC_DATES.registration_expiry,
        DOC_DATES.compulsory_insurance_expiry, DOC_DATES.tax_expiry]
    );
  }

  await conn.query(
    `INSERT INTO vehicle_inspections
       (vehicle_id, inspected_by, inspection_date, expiry_date, result, notes)
     VALUES (?, ?, ?, ?, 'PASSED', '__test date shape')`,
    [INSPECTED.id, transportUserId, INSPECTION_DATE, INSPECTION_EXPIRY]
  );
}

async function unseed(conn) {
  await conn.query('DELETE FROM vehicle_inspections WHERE vehicle_id IN (?, ?)', [INSPECTED.id, UNINSPECTED.id]);
  await conn.query('DELETE FROM vehicles WHERE id IN (?, ?)', [INSPECTED.id, UNINSPECTED.id]);
  await conn.query('DELETE FROM users WHERE username = ?', [TRANSPORT.username]);
}

beforeAll(async () => {
  const conn = await getTestConnection();
  try {
    await unseed(conn);
    await seed(conn);
  } finally {
    await conn.end();
  }

  const res = await request(app).post('/api/auth/login').send(TRANSPORT);
  expect(res.status).toBe(200);
  token = res.body.data.access_token;
});

afterAll(async () => {
  const conn = await getTestConnection();
  try {
    await unseed(conn);
  } finally {
    await conn.end();
  }
});

function get(path) {
  return request(app).get(path).set('Authorization', `Bearer ${token}`);
}

/** Asserts every DATE field on a vehicle row, and names the field that fails. */
function expectCalendarDates(vehicle) {
  const expected = {
    ...DOC_DATES,
    latest_inspection_date: INSPECTION_DATE,
    inspection_expiry: INSPECTION_EXPIRY,
  };
  for (const field of VEHICLE_DATE_FIELDS) {
    if (!(field in vehicle)) continue;
    if (vehicle[field] == null) continue;
    // The shape assertion is what catches the defect: an instant here means
    // the client is one `.slice(0, 10)` away from reading the day before.
    expect(`${field}=${vehicle[field]}`).not.toMatch(INSTANT_SHAPE);
    if (expected[field]) expect(vehicle[field]).toBe(expected[field]);
  }
}

describe('GET /api/transport/vehicles emits calendar dates, not instants', () => {
  test('the fixture is in the list (guards against a vacuous pass)', async () => {
    const res = await get('/api/transport/vehicles?per_page=100');
    expect(res.status).toBe(200);
    const v = res.body.data.find((x) => x.id === INSPECTED.id);
    expect(v).toBeDefined();
    expect(v.insurance_expiry).toBeTruthy();
    expect(v.latest_inspection_date).toBeTruthy();
  });

  test('all six DATE fields come back as YYYY-MM-DD', async () => {
    const res = await get('/api/transport/vehicles?per_page=100');
    const v = res.body.data.find((x) => x.id === INSPECTED.id);
    expectCalendarDates(v);
  });

  test('the whole page is free of the instant shape', async () => {
    const res = await get('/api/transport/vehicles?per_page=100');
    const offenders = [];
    for (const row of res.body.data) {
      for (const field of VEHICLE_DATE_FIELDS) {
        if (typeof row[field] === 'string' && INSTANT_SHAPE.test(row[field])) {
          offenders.push(`${row.id}.${field}=${row[field]}`);
        }
      }
    }
    // This is the measurement the verifier made against the sandbox: 196
    // instant-shaped values across 50 rows. It must be zero.
    expect(offenders).toEqual([]);
  });

  test('a client that takes the first ten characters reads the stored day', async () => {
    const res = await get('/api/transport/vehicles?per_page=100');
    const v = res.body.data.find((x) => x.id === INSPECTED.id);
    // Before the fix this was '2020-01-14' — the day before the stored date.
    expect(tenCharacterPrefix(v.insurance_expiry)).toBe(DOC_DATES.insurance_expiry);
    expect(tenCharacterPrefix(v.tax_expiry)).toBe(DOC_DATES.tax_expiry);
    expect(tenCharacterPrefix(v.latest_inspection_date)).toBe(INSPECTION_DATE);
  });

  test('TIMESTAMP columns are left as instants', async () => {
    const res = await get('/api/transport/vehicles?per_page=100');
    const v = res.body.data.find((x) => x.id === INSPECTED.id);
    // created_at is a real instant and must NOT be flattened to a date by the
    // same mapper — this pins the boundary of the fix.
    expect(String(v.created_at)).toMatch(INSTANT_SHAPE);
  });
});

describe('the other transport read endpoints share the shape', () => {
  test('GET /api/transport/vehicles/:id', async () => {
    const res = await get(`/api/transport/vehicles/${INSPECTED.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(INSPECTED.id);
    expectCalendarDates(res.body.data);
  });

  test('GET /api/transport/vehicles/pending', async () => {
    const res = await get('/api/transport/vehicles/pending?per_page=100');
    expect(res.status).toBe(200);
    const v = res.body.data.find((x) => x.id === UNINSPECTED.id);
    expect(v).toBeDefined();
    expect(v.insurance_expiry).toBe(DOC_DATES.insurance_expiry);
    expect(`insurance_expiry=${v.insurance_expiry}`).not.toMatch(INSTANT_SHAPE);
    expect(v.tax_expiry).toBe(DOC_DATES.tax_expiry);
  });

  test('GET /api/transport/vehicles/expiring?expired=true', async () => {
    const res = await get('/api/transport/vehicles/expiring?expired=true&per_page=100');
    expect(res.status).toBe(200);
    const v = res.body.data.find((x) => x.id === INSPECTED.id);
    expect(v).toBeDefined();
    expectCalendarDates(v);
  });

  test('GET /api/transport/inspections', async () => {
    const res = await get(`/api/transport/inspections?vehicle_id=${INSPECTED.id}`);
    expect(res.status).toBe(200);
    const row = res.body.data.find((x) => x.vehicle_id === INSPECTED.id);
    expect(row).toBeDefined();
    expect(row.inspection_date).toBe(INSPECTION_DATE);
    expect(row.expiry_date).toBe(INSPECTION_EXPIRY);
    expect(`inspection_date=${row.inspection_date}`).not.toMatch(INSTANT_SHAPE);
    expect(`expiry_date=${row.expiry_date}`).not.toMatch(INSTANT_SHAPE);
  });
});

describe('the service layer, not just the route', () => {
  test('getVehicles returns calendar-date strings', async () => {
    const { vehicles } = await transportSvc.getVehicles({ search: INSPECTED.plate, per_page: 100 });
    const v = vehicles.find((x) => x.id === INSPECTED.id);
    expect(v).toBeDefined();
    expect(v.insurance_expiry).toBe(DOC_DATES.insurance_expiry);
    expect(typeof v.insurance_expiry).toBe('string');
  });

  test('getVehicleById returns calendar-date strings', async () => {
    const v = await transportSvc.getVehicleById(INSPECTED.id);
    expect(v).not.toBeNull();
    expectCalendarDates(v);
  });

  test('a vehicle with no inspection keeps nulls rather than acquiring today', async () => {
    // The other half of the fix: `toBangkokDate` used to default to `new Date()`,
    // so a NULL/absent column could come back as TODAY. Nulls must stay null.
    const v = await transportSvc.getVehicleById(UNINSPECTED.id);
    expect(v.latest_inspection_date).toBeNull();
    expect(v.inspection_expiry).toBeNull();
  });
});
