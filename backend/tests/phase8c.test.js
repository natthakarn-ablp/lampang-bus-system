'use strict';

require('dotenv').config();
const request = require('supertest');
const mysql   = require('mysql2/promise');
const app     = require('../src/app');

const DRIVER = { username: '__TEST PLATE 9999', password: 'testpass123' };
const SCHOOL = { username: '__test_school', password: 'testpass123' };
const TEST_STUDENT_ID = 99999;

let driverToken = '', schoolToken = '';

async function login(creds) {
  const res = await request(app).post('/api/auth/login').send(creds);
  return res.body.data.access_token;
}

beforeAll(async () => {
  driverToken = await login(DRIVER);
  schoolToken = await login(SCHOOL);
});

afterAll(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    database: process.env.DB_NAME || 'lampang_bus',
    user: process.env.DB_USER || 'lampang',
    password: process.env.DB_PASSWORD || '',
    charset: 'utf8mb4',
  });
  await conn.query(`DELETE FROM roster_change_requests WHERE vehicle_id = 'V-test000000ab'`);
  await conn.query(`DELETE FROM student_leaves WHERE student_id = ?`, [TEST_STUDENT_ID]);
  await conn.end();
});

// ─── 1. Roster returns leave_session field ──────────────────────────────────

describe('Roster returns leave_session', () => {
  test('GET /api/driver/roster includes leave_session (null when no leave)', async () => {
    const res = await request(app)
      .get('/api/driver/roster?session=morning')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    const student = res.body.data.students.find(s => s.id === TEST_STUDENT_ID);
    expect(student).toBeDefined();
    expect(student).toHaveProperty('leave_session');
    expect(student).toHaveProperty('school_name');
  });
});

// ─── 2. Leave with session=morning ──────────────────────────────────────────

describe('Leave with morning session', () => {
  test('creates morning leave → roster shows leave_session=morning', async () => {
    const leaveRes = await request(app)
      .post('/api/driver/leave')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });
    expect(leaveRes.status).toBe(201);

    const rosterRes = await request(app)
      .get('/api/driver/roster?session=morning')
      .set('Authorization', `Bearer ${driverToken}`);
    const student = rosterRes.body.data.students.find(s => s.id === TEST_STUDENT_ID);
    expect(student.leave_session).toBe('morning');

    // Cancel for cleanup
    const listRes = await request(app).get('/api/driver/leaves').set('Authorization', `Bearer ${driverToken}`);
    for (const l of listRes.body.data.filter(x => x.student_id === TEST_STUDENT_ID)) {
      await request(app).delete(`/api/driver/leave/${l.id}`).set('Authorization', `Bearer ${driverToken}`);
    }
  });
});

// ─── 3. Leave with session=evening ──────────────────────────────────────────

describe('Leave with evening session', () => {
  test('creates evening leave → roster shows leave_session=evening', async () => {
    const leaveRes = await request(app)
      .post('/api/driver/leave')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'evening' });
    expect(leaveRes.status).toBe(201);

    const rosterRes = await request(app)
      .get('/api/driver/roster?session=evening')
      .set('Authorization', `Bearer ${driverToken}`);
    const student = rosterRes.body.data.students.find(s => s.id === TEST_STUDENT_ID);
    expect(student.leave_session).toBe('evening');

    // Cancel
    const listRes = await request(app).get('/api/driver/leaves').set('Authorization', `Bearer ${driverToken}`);
    for (const l of listRes.body.data.filter(x => x.student_id === TEST_STUDENT_ID)) {
      await request(app).delete(`/api/driver/leave/${l.id}`).set('Authorization', `Bearer ${driverToken}`);
    }
  });
});

// ─── 4. Leave with session=both ─────────────────────────────────────────────

describe('Leave with both session', () => {
  test('creates full-day leave → roster shows leave_session=both', async () => {
    const leaveRes = await request(app)
      .post('/api/driver/leave')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'both' });
    expect(leaveRes.status).toBe(201);

    const rosterRes = await request(app)
      .get('/api/driver/roster?session=morning')
      .set('Authorization', `Bearer ${driverToken}`);
    const student = rosterRes.body.data.students.find(s => s.id === TEST_STUDENT_ID);
    expect(student.leave_session).toBe('both');

    // Cancel
    const listRes = await request(app).get('/api/driver/leaves').set('Authorization', `Bearer ${driverToken}`);
    for (const l of listRes.body.data.filter(x => x.student_id === TEST_STUDENT_ID)) {
      await request(app).delete(`/api/driver/leave/${l.id}`).set('Authorization', `Bearer ${driverToken}`);
    }
  });
});

// ─── 5. Leave cancel restores state ─────────────────────────────────────────

describe('Leave cancel restores pending state', () => {
  test('after cancel, leave_session becomes null', async () => {
    const leaveRes = await request(app)
      .post('/api/driver/leave')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });
    const leaveId = leaveRes.body.data.id;

    await request(app).delete(`/api/driver/leave/${leaveId}`).set('Authorization', `Bearer ${driverToken}`);

    const rosterRes = await request(app)
      .get('/api/driver/roster?session=morning')
      .set('Authorization', `Bearer ${driverToken}`);
    const student = rosterRes.body.data.students.find(s => s.id === TEST_STUDENT_ID);
    expect(student.leave_session).toBeNull();
  });
});

// ─── 5b. Summary cards exclude leave students from pending ──────────────────

describe('Summary cards exclude leave students', () => {
  test('morning leave reduces morning_pending in status-today', async () => {
    // Get baseline
    const before = await request(app)
      .get('/api/driver/status-today')
      .set('Authorization', `Bearer ${driverToken}`);
    const pendingBefore = parseInt(before.body.data.summary.morning_pending, 10);

    // Create morning leave
    const leaveRes = await request(app)
      .post('/api/driver/leave')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });
    expect(leaveRes.status).toBe(201);

    // Check pending decreased
    const after = await request(app)
      .get('/api/driver/status-today')
      .set('Authorization', `Bearer ${driverToken}`);
    const pendingAfter = parseInt(after.body.data.summary.morning_pending, 10);
    expect(pendingAfter).toBeLessThan(pendingBefore);

    // Cleanup
    const listRes = await request(app).get('/api/driver/leaves').set('Authorization', `Bearer ${driverToken}`);
    for (const l of listRes.body.data.filter(x => x.student_id === TEST_STUDENT_ID)) {
      await request(app).delete(`/api/driver/leave/${l.id}`).set('Authorization', `Bearer ${driverToken}`);
    }
  });

  test('both leave reduces both morning_pending and evening_pending', async () => {
    const before = await request(app)
      .get('/api/driver/status-today')
      .set('Authorization', `Bearer ${driverToken}`);
    const mBefore = parseInt(before.body.data.summary.morning_pending, 10);
    const eBefore = parseInt(before.body.data.summary.evening_pending, 10);

    const leaveRes = await request(app)
      .post('/api/driver/leave')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'both' });
    expect(leaveRes.status).toBe(201);

    const after = await request(app)
      .get('/api/driver/status-today')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(parseInt(after.body.data.summary.morning_pending, 10)).toBeLessThan(mBefore);
    expect(parseInt(after.body.data.summary.evening_pending, 10)).toBeLessThan(eBefore);

    // Cleanup
    const listRes = await request(app).get('/api/driver/leaves').set('Authorization', `Bearer ${driverToken}`);
    for (const l of listRes.body.data.filter(x => x.student_id === TEST_STUDENT_ID)) {
      await request(app).delete(`/api/driver/leave/${l.id}`).set('Authorization', `Bearer ${driverToken}`);
    }
  });
});

// ─── 5c. Duplicate leave returns Thai error ─────────────────────────────────

describe('Duplicate leave error', () => {
  test('duplicate morning leave returns 409 with Thai message', async () => {
    // Create first
    const first = await request(app)
      .post('/api/driver/leave')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });
    expect(first.status).toBe(201);

    // Try duplicate
    const dup = await request(app)
      .post('/api/driver/leave')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'morning' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/ถูกบันทึกการลา/);

    // Cleanup
    const listRes = await request(app).get('/api/driver/leaves').set('Authorization', `Bearer ${driverToken}`);
    for (const l of listRes.body.data.filter(x => x.student_id === TEST_STUDENT_ID)) {
      await request(app).delete(`/api/driver/leave/${l.id}`).set('Authorization', `Bearer ${driverToken}`);
    }
  });
});

// ─── 5d. No full_day value used anywhere ────────────────────────────────────

describe('Leave session values', () => {
  test('backend rejects full_day (only morning/evening/both accepted)', async () => {
    const res = await request(app)
      .post('/api/driver/leave')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ student_id: TEST_STUDENT_ID, session: 'full_day' });
    expect(res.status).toBe(400);
  });
});

// ─── 6. Profile returns insurance fields ────────────────────────────────────

describe('Profile returns insurance fields', () => {
  test('GET /api/driver/profile returns insurance_type, insurance_status, insurance_expiry', async () => {
    const res = await request(app)
      .get('/api/driver/profile')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('insurance_type');
    expect(res.body.data).toHaveProperty('insurance_status');
    expect(res.body.data).toHaveProperty('insurance_expiry');
    expect(res.body.data).toHaveProperty('vehicle_type');
  });
});

// ─── 7. Profile update with dropdown values ─────────────────────────────────

describe('Profile update with dropdown values', () => {
  test('saves vehicle_type, insurance_status, insurance_type from dropdown values', async () => {
    const res = await request(app)
      .put('/api/driver/profile')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        vehicle_type: 'รถตู้',
        insurance_status: 'คุ้มครองปกติ',
        insurance_type: 'ประกันภัยชั้น 1',
        insurance_expiry: '2027-12-31',
      });
    expect(res.status).toBe(200);

    const profile = await request(app)
      .get('/api/driver/profile')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(profile.body.data.vehicle_type).toBe('รถตู้');
    expect(profile.body.data.insurance_status).toBe('คุ้มครองปกติ');
    expect(profile.body.data.insurance_type).toBe('ประกันภัยชั้น 1');
    expect(profile.body.data.insurance_expiry).toMatch(/2027-12-31/);
  });

  test('saves custom vehicle_type ("อื่นๆ" stores actual text)', async () => {
    const res = await request(app)
      .put('/api/driver/profile')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ vehicle_type: 'รถสามล้อ' });
    expect(res.status).toBe(200);

    const profile = await request(app)
      .get('/api/driver/profile')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(profile.body.data.vehicle_type).toBe('รถสามล้อ');

    // Restore
    await request(app)
      .put('/api/driver/profile')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ vehicle_type: 'รถตู้', name: '__Test Driver', phone: '0000000001' });
  });
});

// ─── 8. Remove request still works ──────────────────────────────────────────

describe('Remove request flow', () => {
  test('remove request for existing student works', async () => {
    const res = await request(app)
      .post('/api/driver/roster-request')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        student_id: TEST_STUDENT_ID,
        request_type: 'remove',
        reason: 'ย้ายรถ',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending');
  });
});

// ─── 9. Schools endpoint ────────────────────────────────────────────────────

describe('Schools endpoint', () => {
  test('GET /api/driver/schools returns list', async () => {
    const res = await request(app)
      .get('/api/driver/schools')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

// ─── 10. Add-student request with new_student_data ──────────────────────────

describe('Add-student request', () => {
  test('accepts new_student_data (or returns schema error with Thai message)', async () => {
    const res = await request(app)
      .post('/api/driver/roster-request')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        request_type: 'add',
        new_student_data: {
          prefix: 'เด็กชาย', first_name: 'ทดสอบ', last_name: 'ใหม่',
          school_id: '__TSCH', parent_phone: '0812345678',
        },
      });
    // 201 if migration 009 applied, 500 with Thai message if not
    expect([201, 500]).toContain(res.status);
    if (res.status === 500) {
      expect(res.body.message).toMatch(/migration 009/);
    }
  });

  test('rejects invalid parent phone', async () => {
    const res = await request(app)
      .post('/api/driver/roster-request')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        request_type: 'add',
        new_student_data: {
          first_name: 'Test', last_name: 'BadPhone',
          school_id: '__TSCH', parent_phone: '123',
        },
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/เบอร์โทร/);
  });
});
