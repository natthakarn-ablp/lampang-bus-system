'use strict';

/**
 * GPS route history (replay) + offline batch flush — route level, DB-free.
 *
 * The pool is replaced by a tiny in-memory "database" that answers the
 * vehicle-scope query from fixtures by reading the params the real SQL binds
 * (vehicleScopeSql), so these tests prove the routes bind the RIGHT scope
 * (JWT-derived school / grade / affiliation) — school A cannot read school B's
 * vehicle, a grade teacher only sees vehicles carrying her grade, an
 * affiliation stops at its boundary. tests/vehicleTrack.test.js runs the same
 * scope against real MySQL in CI.
 */

require('./loadTestEnv');

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = JSON.parse(Buffer.from(req.headers['x-test-user'] || 'e30=', 'base64').toString('utf8'));
    next();
  },
}));
const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({
  pool: { query: (...args) => mockQuery(...args), getConnection: jest.fn() },
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));
jest.mock('../src/services/safetyPolicy.service', () => ({
  ...jest.requireActual('../src/services/safetyPolicy.service'),
  assessDriverOperation: jest.fn().mockResolvedValue({ decision: 'ALLOW', audit_required: false }),
}));
jest.mock('../src/services/checkin.service', () => ({
  ...jest.requireActual('../src/services/checkin.service'),
  getDriverVehicle: jest.fn().mockResolvedValue({ vehicle_id: 'V-A', plate_no: 'กข 1 ลำปาง', driver_id: 5 }),
}));

const express = require('express');
const request = require('supertest');
const { todayBangkok } = require('../src/utils/thaiTime');
const { addDays } = require('../src/services/vehicleTrack.service');

const app = express();
app.use(express.json());
app.use('/api/school', require('../src/routes/school.routes'));
app.use('/api/affiliation', require('../src/routes/affiliation.routes'));
app.use('/api/province', require('../src/routes/province.routes'));
app.use('/api/admin', require('../src/routes/admin.routes'));
app.use('/api/driver', require('../src/routes/driver.routes'));
app.use(require('../src/middleware/errorHandler'));

/* ── fixtures ─────────────────────────────────────────────────────────── */
const VEHICLES = { 'V-A': 'กข 1 ลำปาง', 'V-A5': 'กข 5 ลำปาง', 'V-B': 'คง 2 ลำปาง', 'V-X': 'จจ 9 ลำปาง' };
const STUDENTS = [
  { vehicle: 'V-A',  school: 'SCHA', aff: 'AFF1', grade: 'ป.4' },
  { vehicle: 'V-A5', school: 'SCHA', aff: 'AFF1', grade: 'ประถมศึกษาปีที่ 5' },
  { vehicle: 'V-B',  school: 'SCHB', aff: 'AFF2', grade: 'ป.4' },
];
const HISTORY = [];
const today = todayBangkok();
const yesterday = addDays(today, -1);
const bkk = (day, hms) => new Date(`${day}T${hms}+07:00`);

function fakeDb(sql, params = []) {
  if (/FROM vehicles v\s+WHERE v.is_deleted = FALSE AND v.id = \?/.test(sql)) {
    const [vid, scopeA, ...rest] = params;
    if (!VEHICLES[vid]) return [[]];
    let ok = true;
    if (/sc\.affiliation_id = \?/.test(sql)) {
      ok = STUDENTS.some(s => s.vehicle === vid && s.aff === scopeA);
    } else if (/s\.school_id = \?/.test(sql)) {
      ok = STUDENTS.some(s => s.vehicle === vid && s.school === scopeA && (rest.length === 0 || rest.includes(s.grade)));
    }
    return [ok ? [{ vehicle_id: vid, plate_no: VEHICLES[vid], vehicle_type: 'รถตู้' }] : []];
  }
  if (/FROM vehicle_location_history/.test(sql) && /^\s*SELECT/.test(sql)) {
    if (/recorded_at IN/.test(sql)) {
      const [vid, ...lits] = params;
      return [HISTORY.filter(h => h.vehicle_id === vid && lits.includes(h.lit)).map(h => ({ recorded_at: h.lit }))];
    }
    const [vid] = params;
    return [HISTORY.filter(h => h.vehicle_id === vid).map(h => ({
      day: h.lit.slice(0, 10), latitude: h.lat, longitude: h.lng, accuracy_meters: 10, speed_mps: 5,
      recorded_at: new Date(h.lit.replace(' ', 'T') + '+07:00'),
    }))];
  }
  if (/INSERT INTO vehicle_location_history/.test(sql)) {
    for (let i = 0; i < params.length; i += 9) {
      HISTORY.push({ vehicle_id: params[i], lat: params[i + 2], lng: params[i + 3], lit: params[i + 7] });
    }
    return [{ affectedRows: params.length / 9 }];
  }
  if (/INSERT INTO vehicle_latest_locations/.test(sql)) return [{ affectedRows: 1 }];
  if (/FROM\s+driver_vehicle_assignments/.test(sql)) return [[{ driver_id: 5 }]];
  if (/audit_logs/.test(sql)) return [[]];
  return [[]];
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockImplementation(async (sql, params) => fakeDb(sql, params));
});

const as = (user) => ({ 'x-test-user': Buffer.from(JSON.stringify({ id: 1, ...user }), 'utf8').toString('base64') });
const SCHOOL_A = as({ role: 'school', scopeId: 'SCHA', gradeScope: null });
const SCHOOL_B = as({ role: 'school', scopeId: 'SCHB', gradeScope: null });
const TEACHER_A4 = as({ role: 'school', scopeId: 'SCHA', gradeScope: 'ป.4' });
const TEACHER_A6 = as({ role: 'school', scopeId: 'SCHA', gradeScope: 'ป.6' });
const AFF1 = as({ role: 'affiliation', scopeId: 'AFF1' });
const PROVINCE = as({ role: 'province', scopeId: 'LPG' });
const ADMIN = as({ role: 'admin' });
const DRIVER = as({ role: 'driver', username: 'กข 1 ลำปาง' });

const track = (role, vid, q = '') => `/api/${role}/vehicles/${encodeURIComponent(vid)}/track${q}`;
const days = (role, vid, q = '') => `/api/${role}/vehicles/${encodeURIComponent(vid)}/track-days${q}`;

describe('replay scope — identical to the live-vehicle list', () => {
  test('school A reads its own vehicle', async () => {
    const res = await request(app).get(track('school', 'V-A')).set(SCHOOL_A);
    expect(res.status).toBe(200);
    expect(res.body.data.vehicle).toEqual({ vehicle_id: 'V-A', plate_no: 'กข 1 ลำปาง', vehicle_type: 'รถตู้' });
    expect(res.body.data.retention_days).toBe(7);
  });

  test('school A cannot read school B\'s vehicle (404, indistinguishable from "no such vehicle")', async () => {
    const res = await request(app).get(track('school', 'V-B')).set(SCHOOL_A);
    expect(res.status).toBe(404);
    expect((await request(app).get(days('school', 'V-B')).set(SCHOOL_A)).status).toBe(404);
    expect((await request(app).get(track('school', 'V-NOPE')).set(SCHOOL_A)).status).toBe(404);
  });

  test('a spoofed ?school_id is ignored for a school account', async () => {
    const res = await request(app).get(track('school', 'V-B', '?school_id=SCHB')).set(SCHOOL_A);
    expect(res.status).toBe(404);
    expect((await request(app).get(track('school', 'V-B')).set(SCHOOL_B)).status).toBe(200);
  });

  test('grade teacher reads a vehicle carrying a pupil of her grade', async () => {
    expect((await request(app).get(track('school', 'V-A')).set(TEACHER_A4)).status).toBe(200);
    expect((await request(app).get(days('school', 'V-A')).set(TEACHER_A4)).status).toBe(200);
  });

  test('grade teacher gets 404 for a vehicle carrying only other grades of her school', async () => {
    expect((await request(app).get(track('school', 'V-A5')).set(TEACHER_A4)).status).toBe(404);
    expect((await request(app).get(track('school', 'V-A')).set(TEACHER_A6)).status).toBe(404);
    // ...while the full school account sees it (tolerant grade spelling irrelevant)
    expect((await request(app).get(track('school', 'V-A5')).set(SCHOOL_A)).status).toBe(200);
  });

  test('the grade filter is bound tolerantly (every spelling of ป.4)', async () => {
    await request(app).get(track('school', 'V-A')).set(TEACHER_A4);
    const scopeCall = mockQuery.mock.calls.find(([sql]) => /v\.id = \?/.test(sql));
    expect(scopeCall[1]).toEqual(expect.arrayContaining(['V-A', 'SCHA', 'ป.4', 'ประถมศึกษาปีที่ 4']));
    expect(scopeCall[1].length).toBe((scopeCall[0].match(/\?/g) || []).length);
  });

  test('affiliation reads vehicles of its schools and stops at its boundary', async () => {
    expect((await request(app).get(track('affiliation', 'V-A')).set(AFF1)).status).toBe(200);
    expect((await request(app).get(track('affiliation', 'V-B')).set(AFF1)).status).toBe(404);
    expect((await request(app).get(track('affiliation', 'V-B', '?affiliation_id=AFF2')).set(AFF1)).status).toBe(404);
  });

  test('province and admin read every vehicle, even one with no pupils', async () => {
    for (const vid of ['V-A', 'V-B', 'V-X']) {
      expect((await request(app).get(track('province', vid)).set(PROVINCE)).status).toBe(200);
      expect((await request(app).get(track('admin', vid)).set(ADMIN)).status).toBe(200);
    }
  });

  test('other roles are refused by the role guard', async () => {
    expect((await request(app).get(track('school', 'V-A')).set(AFF1)).status).toBe(403);
    expect((await request(app).get(track('province', 'V-A')).set(SCHOOL_A)).status).toBe(403);
    expect((await request(app).get(track('admin', 'V-A')).set(PROVINCE)).status).toBe(403);
    expect((await request(app).get(track('school', 'V-A')).set(DRIVER)).status).toBe(403);
  });

  test('a malformed vehicle id is a 400 before any query', async () => {
    const res = await request(app).get(track('province', "V-A' OR '1'='1")).set(PROVINCE);
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('replay date validation', () => {
  test('defaults to today', async () => {
    const res = await request(app).get(track('province', 'V-A')).set(PROVINCE);
    expect(res.status).toBe(200);
    expect(res.body.data.date).toBe(today);
  });
  test.each([
    ['malformed', '?date=7-11-2026'],
    ['impossible', '?date=2026-02-31'],
    ['future', `?date=${addDays(today, 1)}`],
    ['older than 7-day retention', `?date=${addDays(today, -7)}`],
  ])('%s → 400', async (_label, q) => {
    const res = await request(app).get(track('province', 'V-A', q)).set(PROVINCE);
    expect(res.status).toBe(400);
  });
  test('6 days back is still inside retention', async () => {
    expect((await request(app).get(track('province', 'V-A', `?date=${addDays(today, -6)}`)).set(PROVINCE)).status).toBe(200);
  });
  test('track-days returns exactly the retention window, oldest first', async () => {
    const res = await request(app).get(days('province', 'V-A')).set(PROVINCE);
    expect(res.status).toBe(200);
    expect(res.body.data.days).toHaveLength(7);
    expect(res.body.data.days[0].date).toBe(addDays(today, -6));
    expect(res.body.data.days[6].date).toBe(today);
    expect((await request(app).get(days('province', 'V-A', '?days=30')).set(PROVINCE)).body.data.days).toHaveLength(7);
    expect((await request(app).get(days('province', 'V-A', '?days=abc')).set(PROVINCE)).status).toBe(400);
  });
  test('the day query binds Bangkok wall-clock bounds', async () => {
    await request(app).get(track('province', 'V-A', `?date=${yesterday}`)).set(PROVINCE);
    const call = mockQuery.mock.calls.find(([sql]) => /FROM vehicle_location_history/.test(sql));
    expect(call[1]).toEqual(['V-A', `${yesterday} 00:00:00`, `${today} 00:00:00`]);
  });
});

describe('POST /api/driver/vehicle-location/batch', () => {
  const pt = (day, hms, extra = {}) => ({
    latitude: 18.29, longitude: 99.49, accuracy_meters: 12, speed_mps: 6, heading_deg: 90,
    recorded_at: bkk(day, hms).toISOString(), ...extra,
  });
  const post = (points) => request(app).post('/api/driver/vehicle-location/batch').set(DRIVER).send({ points });

  beforeEach(() => { HISTORY.length = 0; });

  test('rejects an empty / missing points array', async () => {
    expect((await post([])).status).toBe(400);
    expect((await request(app).post('/api/driver/vehicle-location/batch').set(DRIVER).send({})).status).toBe(400);
  });

  test('rejects more than 200 points as a whole', async () => {
    const many = Array.from({ length: 201 }, (_, i) => pt(yesterday, `06:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`));
    const res = await post(many);
    expect(res.status).toBe(400);
    expect(HISTORY).toHaveLength(0);
  });

  test('validates each point on its own without failing the batch', async () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const res = await post([
      pt(yesterday, '06:00:00'),
      pt(yesterday, '06:00:15', { latitude: 91 }),
      pt(yesterday, '06:00:30', { longitude: 'x' }),
      pt(yesterday, '06:00:45', { recorded_at: 'not a date' }),
      pt(yesterday, '06:01:00', { recorded_at: future }),
      pt(addDays(today, -8), '06:00:00'),
      pt(yesterday, '12:00:00'),
      pt(yesterday, '04:59:00'),
      pt(yesterday, '09:01:00'),
      pt(yesterday, '19:00:30'),
      pt(yesterday, '06:00:00', { latitude: 0, longitude: 0 }),
    ]);
    expect(res.status).toBe(200);
    const reasons = res.body.data.results.map(r => r.reason || r.status);
    expect(reasons).toEqual([
      'accepted', 'INVALID_LATITUDE', 'INVALID_LONGITUDE', 'INVALID_RECORDED_AT', 'RECORDED_AT_IN_FUTURE',
      'RECORDED_AT_TOO_OLD', 'OUTSIDE_TRACKING_WINDOW', 'OUTSIDE_TRACKING_WINDOW', 'OUTSIDE_TRACKING_WINDOW',
      'accepted', 'INVALID_COORDINATES',
    ]);
    expect(res.body.data).toMatchObject({ accepted: 2, rejected: 9, duplicates: 0 });
    expect(HISTORY).toHaveLength(2);
    // stored as a Bangkok wall-clock literal, like the single endpoint
    expect(HISTORY[0].lit).toBe(`${yesterday} 06:00:00.000`);
  });

  test('is idempotent: duplicates in the batch and already-stored points are skipped', async () => {
    const first = await post([pt(yesterday, '07:00:00'), pt(yesterday, '07:00:15')]);
    expect(first.body.data.accepted).toBe(2);
    const again = await post([pt(yesterday, '07:00:00'), pt(yesterday, '07:00:15'), pt(yesterday, '07:00:30'), pt(yesterday, '07:00:30')]);
    expect(again.body.data).toMatchObject({ accepted: 1, duplicates: 3 });
    expect(HISTORY).toHaveLength(3);
  });

  test('never runs with a client-supplied vehicle_id', async () => {
    await post([pt(yesterday, '08:00:00', { vehicle_id: 'V-B' })]);
    expect(HISTORY.every(h => h.vehicle_id === 'V-A')).toBe(true);
  });

  test('only moves the live row with a newer-than-stored guard', async () => {
    await post([pt(yesterday, '08:10:00'), pt(yesterday, '08:05:00')]);
    const call = mockQuery.mock.calls.find(([sql]) => /INSERT INTO vehicle_latest_locations/.test(sql));
    expect(call[0]).toMatch(/IF\(VALUES\(recorded_at\) > recorded_at/);
    // newest of the batch, and recorded_at is the LAST assignment
    expect(call[1][7]).toBe(`${yesterday} 08:10:00.000`);
    expect(call[0].trim().split('\n').pop()).toMatch(/recorded_at\s+= IF/);
  });

  test('all points rejected → no DB write at all', async () => {
    const res = await post([pt(yesterday, '12:00:00')]);
    expect(res.status).toBe(200);
    expect(res.body.data.accepted).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('POST /api/driver/vehicle-location — tracking window', () => {
  test('outside the window: 200, not stored, no DB write', async () => {
    const res = await request(app).post('/api/driver/vehicle-location').set(DRIVER)
      .send({ latitude: 18.29, longitude: 99.49, recorded_at: bkk(yesterday, '12:00:00').toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ stored: false, reason: 'OUTSIDE_TRACKING_WINDOW' });
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT/.test(sql))).toBe(false);
  });

  // Only Date is faked so supertest's timers keep working.
  const fakeClock = (iso) => jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
      'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
      'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  afterEach(() => { jest.useRealTimers(); });

  test('inside the window (fix and server clock): stored', async () => {
    fakeClock(`${today}T05:00:30+07:00`);
    const res = await request(app).post('/api/driver/vehicle-location').set(DRIVER)
      .send({ latitude: 18.29, longitude: 99.49, recorded_at: bkk(today, '05:00:00').toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.data.stored).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO vehicle_latest_locations/.test(sql))).toBe(true);
  });

  test('a fix stamped inside the window but sent at night (wrong phone clock) is not stored', async () => {
    fakeClock(`${today}T23:00:00+07:00`);
    const res = await request(app).post('/api/driver/vehicle-location').set(DRIVER)
      .send({ latitude: 18.29, longitude: 99.49, recorded_at: bkk(today, '06:00:00').toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.data.stored).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT/.test(sql))).toBe(false);
  });
});

describe('live-vehicle lists expose the tracking windows for the calm off-hours note', () => {
  test('province list', async () => {
    const res = await request(app).get('/api/province/live-vehicles').set(PROVINCE);
    expect(res.status).toBe(200);
    expect(res.body.data.tracking).toMatchObject({ label: '05:00–09:00, 15:00–19:00' });
    expect(typeof res.body.data.tracking.in_window_now).toBe('boolean');
  });
});
