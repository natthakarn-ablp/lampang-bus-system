'use strict';

// Readiness fixes for the parent role (round 1): parent-01, -02, -03/load-06,
// -07, -08. DB-free: the pool and LINE verification are mocked.

const { normalizePhone, isValidPhone } = require('../src/utils/phone');
const { classifyImportRow } = require('../src/utils/studentImportClassifier');
const { planBackfill } = require('../scripts/backfill-parent-phone-zero');
const { lineUserOrIpKey } = require('../src/middleware/rateLimiters');

describe('parent-02 shared normalizePhone', () => {
  test.each([
    ['0812345678', '0812345678'],
    [812345678, '0812345678'],          // ExcelJS numeric cell
    ['812345678', '0812345678'],
    ['612345678', '0612345678'],
    ['912345678', '0912345678'],
    ['081-234-5678', '0812345678'],
    [' 081 234 5678 ', '0812345678'],
    ['+66812345678', '0812345678'],
    ['', ''],
    [null, ''],
  ])('%p -> %p', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  test('does not invent a mobile from a landline or a short number', () => {
    expect(normalizePhone('53123456')).toBe('53123456');   // landline without 0: left as is
    expect(isValidPhone(normalizePhone('53123456'))).toBe(false);
    expect(isValidPhone(normalizePhone('054123456'))).toBe(false); // 9-digit landline
    expect(isValidPhone(normalizePhone('512345678'))).toBe(false); // old classifier padded this
    expect(isValidPhone(normalizePhone('0812345678'))).toBe(true);
  });

  test('import classifier validates the same value the importer stores', () => {
    const base = { rowNum: 2, student_code: 'S1', first_name: 'ก', last_name: 'ข' };
    const ok = classifyImportRow({ row: { ...base, parent_phone: normalizePhone(812345678) }, schoolId: 'SCH1' });
    expect(ok.classification).not.toBe('INVALID_GUARDIAN_PHONE');
    const bad = classifyImportRow({ row: { ...base, parent_phone: '512345678' }, schoolId: 'SCH1' });
    expect(bad.classification).toBe('INVALID_GUARDIAN_PHONE');
    expect(bad.message_th).toMatch(/10 หลัก/);
  });

  test('backfill plan fixes lost zeros, leaves canonical and invalid phones alone, and is idempotent', () => {
    const rows = [
      { id: 1, phone: '812345678' },
      { id: 2, phone: '0812345678' },
      { id: 3, phone: '081-234-5678' },
      { id: 4, phone: '054123456' },
      { id: 5, phone: '   ' },
    ];
    const plan = planBackfill(rows);
    expect(plan.updates).toEqual([
      { id: 1, from: '812345678', to: '0812345678' },
      { id: 3, from: '081-234-5678', to: '0812345678' },
    ]);
    expect(plan.unchanged).toBe(1);
    expect(plan.invalid.map((r) => r.id)).toEqual([4]);

    const after = rows.map((r) => {
      const u = plan.updates.find((x) => x.id === r.id);
      return u ? { ...r, phone: u.to } : r;
    });
    expect(planBackfill(after).updates).toEqual([]);
  });
});

describe('parent-01 LINE push text', () => {
  const { buildNotificationText } = require('../src/services/line.service');

  test('teacher morning tap reads as arrived at school, in Thai', () => {
    const text = buildNotificationText('checkout', { studentName: 'ด.ช. ทดสอบ', status: 'CHECKED_OUT', session: 'morning' });
    expect(text).toContain('แจ้งเตือน: ถึงโรงเรียนแล้ว');
    expect(text).toContain('สถานะ: ส่งแล้ว');
    expect(text).toContain('รอบ: เช้า');
    expect(text).not.toMatch(/CHECKED_|รับเย็น/);
  });

  test('evening boarding reads as boarded to go home', () => {
    const text = buildNotificationText('checkin', { status: 'CHECKED_IN', session: 'evening' });
    expect(text).toContain('แจ้งเตือน: ขึ้นรถกลับบ้านแล้ว');
    expect(text).toContain('รอบ: เย็น');
    expect(text).not.toContain('ส่งเช้า');
  });

  test('emergency keeps its own header', () => {
    expect(buildNotificationText('emergency', {})).toContain('แจ้งเตือน: เหตุฉุกเฉิน');
  });
});

describe('parent-03 / load-06 limiter key', () => {
  test('keys by the verified LINE sub, falls back to the IP', () => {
    expect(lineUserOrIpKey({ lineUserId: 'Uabc', ip: '203.0.113.5' })).toBe('line:Uabc');
    expect(lineUserOrIpKey({ ip: '203.0.113.5' })).toBe('ip:203.0.113.5');
    expect(lineUserOrIpKey({ lineUserId: '', ip: '203.0.113.5' })).toBe('ip:203.0.113.5');
  });
});

describe('parent-07 student lock scoped per school', () => {
  let bindGuard;
  let pool;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
    pool = require('../src/config/database').pool;
    bindGuard = require('../src/services/lineBindGuard');
  });

  test('a code in exactly one school is scoped to that school', async () => {
    pool.query.mockResolvedValueOnce([[{ school_id: 'SCH0001' }]]);
    await expect(bindGuard.resolveStudentLockKey('101')).resolves.toBe('SCH0001:101');
    const [, params] = pool.query.mock.calls[0];
    expect(params).toEqual(['101', 101]);
  });

  test('a code shared by several schools keeps a lock scoped to that set of schools', async () => {
    pool.query.mockResolvedValueOnce([[{ school_id: 'SCH0002' }, { school_id: 'SCH0001' }]]);
    await expect(bindGuard.resolveStudentLockKey('101')).resolves.toBe('multi:SCH0001,SCH0002:101');
    pool.query.mockResolvedValueOnce([[{ school_id: 'SCH0001' }, { school_id: 'SCH0003' }]]);
    await expect(bindGuard.resolveStudentLockKey('101')).resolves.toBe('multi:SCH0001,SCH0003:101');
    const k = bindGuard.keysFor({ phone: '0812345678', studentKey: '101', studentLockKey: 'multi:SCH0001,SCH0002:101' });
    expect(k.student).toMatch(/^student:[0-9a-f]{64}$/);
  });

  test('a code in no school gets no student lock', async () => {
    pool.query.mockResolvedValueOnce([[]]);
    await expect(bindGuard.resolveStudentLockKey('A-1')).resolves.toBeNull();
    expect(pool.query.mock.calls[0][1]).toEqual(['A-1', null]);
  });

  test('keysFor keeps the pair on the typed code and scopes only the student key', () => {
    const scoped = bindGuard.keysFor({ phone: '0812345678', studentKey: '101', studentLockKey: 'SCH0001:101' });
    const scopedOther = bindGuard.keysFor({ phone: '0812345678', studentKey: '101', studentLockKey: 'SCH0002:101' });
    const legacy = bindGuard.keysFor({ phone: '0812345678', studentKey: '101' });
    expect(scoped.pair).toBe(legacy.pair);
    expect(scoped.student).not.toBe(legacy.student);
    expect(scoped.student).not.toBe(scopedOther.student);
    expect(bindGuard.keysFor({ phone: '0812345678', studentKey: '101', studentLockKey: null }).student).toBeNull();
    expect(JSON.stringify(scoped)).not.toMatch(/0812345678|SCH0001/);
  });
});

describe('parent routes (rate-limit keying, parent-08 preview conflict)', () => {
  let app;
  let idTokenSvc;
  let lineSvc;
  const request = require('supertest');
  const express = require('express');

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../src/services/lineIdToken.service', () => ({ verifyIdToken: jest.fn() }));
    jest.doMock('../src/services/lineBindGuard', () => ({
      keysFor: jest.fn(() => ({ pair: 'pair:x', sub: 'sub:x' })),
      resolveStudentLockKey: jest.fn().mockResolvedValue('SCH0001:101'),
      checkLock: jest.fn().mockResolvedValue({ locked: false }),
      noteFailure: jest.fn().mockResolvedValue(),
      noteSuccess: jest.fn().mockResolvedValue(),
    }));
    jest.doMock('../src/services/line.service', () => ({
      auditBind: jest.fn().mockResolvedValue(),
      getLinkedParentId: jest.fn().mockResolvedValue(null),
      findLinkableParent: jest.fn().mockResolvedValue({ found: true, parentId: 7, studentCode: '101', student: { first_name: 'ก' } }),
      getLineUserIdByPhone: jest.fn().mockResolvedValue(null),
      getLinkedChildren: jest.fn().mockResolvedValue([]),
      commitLineLink: jest.fn(),
      PHONE_BOUND_TO_OTHER_MSG: 'เบอร์นี้ผูกกับบัญชี LINE อื่นไว้แล้ว',
      LineBindConflictError: class LineBindConflictError extends Error {},
    }));
    jest.doMock('../src/services/parentConsentGate', () => ({
      guardParentView: jest.fn().mockResolvedValue({ allowed: true }),
      applyChildListGate: jest.fn((children) => ({ children, consent_required: false, consent_granted: true })),
    }));
    jest.doMock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
    idTokenSvc = require('../src/services/lineIdToken.service');
    lineSvc = require('../src/services/line.service');
    const routes = require('../src/routes/parent.routes');
    app = express();
    app.use(express.json());
    app.use('/api/parent', routes);
    app.use((err, _req, res, _next) => res.status(500).json({ message: err.message }));
    idTokenSvc.verifyIdToken.mockImplementation(async (t) => ({ valid: true, userId: `U-${t}` }));
  });

  test('GET /children: each verified LINE user has its own 60/min budget on one IP', async () => {
    for (let i = 0; i < 60; i++) {
      const r = await request(app).get('/api/parent/children').set('Authorization', 'Bearer a');
      expect(r.status).toBe(200);
    }
    const limited = await request(app).get('/api/parent/children').set('Authorization', 'Bearer a');
    expect(limited.status).toBe(429);
    expect(limited.body.message).toMatch(/ถี่เกินไป/);
    const other = await request(app).get('/api/parent/children').set('Authorization', 'Bearer b');
    expect(other.status).toBe(200);
  });

  test('bind-preview verifies the id_token once and keys the bind lock on the resolved school', async () => {
    const bindGuard = require('../src/services/lineBindGuard');
    const r = await request(app).post('/api/parent/line/bind-preview')
      .send({ idToken: 'a', phone: '812345678', student_code: '101' });
    expect(r.status).toBe(200);
    expect(idTokenSvc.verifyIdToken).toHaveBeenCalledTimes(1);
    expect(lineSvc.findLinkableParent).toHaveBeenCalledWith('0812345678', '101');
    expect(bindGuard.keysFor).toHaveBeenCalledWith(expect.objectContaining({ studentLockKey: 'SCH0001:101' }));
  });

  test('bind-preview returns the phone-already-bound 409 before the confirm step', async () => {
    lineSvc.getLineUserIdByPhone.mockResolvedValueOnce('U-someone-else');
    const r = await request(app).post('/api/parent/line/bind-preview')
      .send({ idToken: 'a', phone: '0812345678', student_code: '101' });
    expect(r.status).toBe(409);
    expect(r.body.errors).toContainEqual({ field: 'phone', code: 'PHONE_BOUND_TO_OTHER' });
  });

  test('bind-preview for the LINE user who already owns the phone is not blocked', async () => {
    lineSvc.getLineUserIdByPhone.mockResolvedValueOnce('U-a');
    const r = await request(app).post('/api/parent/line/bind-preview')
      .send({ idToken: 'a', phone: '0812345678', student_code: '101' });
    expect(r.status).toBe(200);
  });
});

describe('parent-02 roster request rejects a phone with no digits', () => {
  let svc;
  let pool;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
    pool = require('../src/config/database').pool;
    svc = require('../src/services/rosterRequest.service');
  });

  const base = { vehicleId: 1, schoolId: 'SCH0001', requestType: 'add', userId: 9 };
  const student = (parent_phone) => ({ first_name: 'ก', last_name: 'ข', school_id: 'SCH0001', parent_phone });

  test.each(['abc', '-', 'ไม่มี', '054123456'])('%p -> 400 before any DB call', async (phone) => {
    await expect(svc.createRequest({ ...base, newStudentData: student(phone) }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(pool.query).not.toHaveBeenCalled();
  });
});
