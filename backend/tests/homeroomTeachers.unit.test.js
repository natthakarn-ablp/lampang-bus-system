'use strict';

/**
 * Homeroom teachers (migration 061, FEATURE_HOMEROOM_TEACHERS) — DB-free.
 * Service rules + the school routes' permission wiring.
 */

const env = require('../src/config/env');
const svc = require('../src/services/homeroom.service');

function fakeDb(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return handler(sql, params);
    },
  };
}

afterEach(() => { env.features.homeroomTeachers = false; });

describe('phone + formatting', () => {
  test.each([
    ['081-234-5678', '0812345678'],
    [' 053 123 456 ', '053123456'],
    ['', null],
    [null, null],
  ])('normalizePhone(%j) → %j', (input, out) => {
    expect(svc.normalizePhone(input)).toBe(out);
  });

  test.each(['12345', '1812345678', '08123456789', 'abc'])('rejects %j with a 400', (bad) => {
    expect(() => svc.normalizePhone(bad)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  test('formatTeachers joins names and shows phones', () => {
    expect(svc.formatTeachers([{ name: 'ครูสมใจ', phone: '0812345678' }, { name: 'ครูสมศรี', phone: null }]))
      .toBe('ครูสมใจ (081-234-5678), ครูสมศรี');
    expect(svc.formatTeachers([{ name: 'ครูสมใจ', phone: '0812345678' }], { withPhone: false })).toBe('ครูสมใจ');
    expect(svc.formatTeachers([])).toBe('');
  });
});

describe('attachHomeroomTeachers', () => {
  const rows = () => ([
    { id: 1, school_id: 'S1', grade: 'ป.1', classroom: '1' },
    { id: 2, school_id: 'S1', grade: 'ป.1', classroom: '2' },
    { id: 3, school_id: 'S1', grade: 'ป.2', classroom: null },
    { id: 4, school_id: 'S2', grade: 'ป.1', classroom: '1' },
  ]);

  test('flag off: no query, rows untouched', async () => {
    const db = fakeDb(() => { throw new Error('must not query'); });
    const r = rows();
    await svc.attachHomeroomTeachers(db, r);
    expect(r[0].homeroom_teachers).toBeUndefined();
    expect(db.calls).toHaveLength(0);
  });

  test('flag on: one query, matched by school + grade + room ("" = no room)', async () => {
    env.features.homeroomTeachers = true;
    const db = fakeDb(() => [[
      { school_id: 'S1', grade: 'ป.1', classroom: '1', teacher_name: 'ครูเอ', phone: '0812345678' },
      { school_id: 'S1', grade: 'ป.1', classroom: '1', teacher_name: 'ครูบี', phone: null },
      { school_id: 'S1', grade: 'ป.2', classroom: '', teacher_name: 'ครูซี', phone: null },
    ]]);
    const r = rows();
    await svc.attachHomeroomTeachers(db, r);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].params).toEqual(['S1', 'S2']);
    expect(r[0].homeroom_teachers.map((t) => t.name)).toEqual(['ครูเอ', 'ครูบี']);
    expect(r[1].homeroom_teachers).toEqual([]);
    expect(r[2].homeroom_teachers.map((t) => t.name)).toEqual(['ครูซี']);
    expect(r[3].homeroom_teachers).toEqual([]); // other school, same grade/room
  });

  test('withPhone:false drops phones', async () => {
    env.features.homeroomTeachers = true;
    const db = fakeDb(() => [[{ school_id: 'S1', grade: 'ป.1', classroom: '1', teacher_name: 'ครูเอ', phone: '0812345678' }]]);
    const r = rows();
    await svc.attachHomeroomTeachers(db, r, { withPhone: false });
    expect(r[0].homeroom_teachers).toEqual([{ name: 'ครูเอ' }]);
  });

  test('missing table degrades to no teachers instead of failing the page', async () => {
    env.features.homeroomTeachers = true;
    const db = fakeDb(() => { const e = new Error('no table'); e.code = 'ER_NO_SUCH_TABLE'; throw e; });
    const r = rows();
    await expect(svc.attachHomeroomTeachers(db, r)).resolves.toBe(r);
  });
});

describe('writes', () => {
  test('add: trims, validates and audits without the phone value', async () => {
    const db = fakeDb((sql) => {
      if (/INSERT INTO homeroom_teachers/.test(sql)) return [{ insertId: 11 }];
      if (/INSERT INTO audit_logs/.test(sql)) return [{}];
      throw new Error(sql);
    });
    const out = await svc.addTeacher(db, {
      schoolId: 'S1', actorId: 5,
      input: { grade: ' ป.1 ', classroom: ' 1 ', teacherName: '  ครู   สมใจ ', phone: '081-234-5678' },
    });
    expect(out).toMatchObject({ id: 11, grade: 'ป.1', classroom: '1', teacherName: 'ครู สมใจ', phone: '0812345678' });
    const audit = db.calls.find((c) => /INSERT INTO audit_logs/.test(c.sql));
    expect(audit.params.join(' ')).not.toContain('0812345678');
  });

  test.each([
    [{ grade: '', teacherName: 'x' }],
    [{ grade: 'ป.1', teacherName: '   ' }],
    [{ grade: 'ป.1', teacherName: 'x'.repeat(151) }],
  ])('add rejects %j with 400 and writes nothing', async (input) => {
    const db = fakeDb(() => { throw new Error('must not write'); });
    await expect(svc.addTeacher(db, { schoolId: 'S1', actorId: 5, input })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('update/delete of another school\'s row is 404', async () => {
    const db = fakeDb((sql) => (/SELECT id, grade/.test(sql) ? [[]] : (() => { throw new Error(sql); })()));
    await expect(svc.updateTeacher(db, { schoolId: 'S1', id: 9, actorId: 5, input: { teacherName: 'x' } }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.deleteTeacher(db, { schoolId: 'S1', id: 9, actorId: 5 }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(db.calls.every((c) => /school_id = \?/.test(c.sql))).toBe(true);
  });
});

describe('school routes', () => {
  let mockUser;
  let app;
  let routeSvc;

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('../src/middleware/auth', () => ({
      authenticate: (req, _res, next) => { req.user = mockUser; next(); },
    }));
    jest.doMock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
    jest.doMock('../src/services/homeroom.service', () => ({
      enabled: jest.fn(() => true),
      listRooms: jest.fn(async () => []),
      addTeacher: jest.fn(async () => ({ id: 1 })),
      updateTeacher: jest.fn(async () => ({ id: 1 })),
      deleteTeacher: jest.fn(async () => ({ id: 1 })),
      teachersBySchool: jest.fn(async () => []),
      attachHomeroomTeachers: jest.fn(async (_db, rows) => rows),
      formatTeachers: jest.fn(() => ''),
    }));
    const express = require('express');
    routeSvc = require('../src/services/homeroom.service');
    const routes = require('../src/routes/school.routes');
    app = express();
    app.use(express.json());
    app.use('/api/school', routes);
    app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }));
  });

  afterAll(() => { jest.resetModules(); });

  beforeEach(() => {
    jest.clearAllMocks();
    routeSvc.enabled.mockReturnValue(true);
    mockUser = { id: 3, role: 'school', scopeId: 'S1', gradeScope: null };
  });

  const request = () => require('supertest')(app);

  test('main account can add; school comes from the token, not the body', async () => {
    const res = await request().post('/api/school/homeroom-teachers').send({ grade: 'ป.1', classroom: '1', teacher_name: 'ครูเอ', school_id: 'OTHER' });
    expect(res.status).toBe(201);
    expect(routeSvc.addTeacher).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ schoolId: 'S1', actorId: 3 }));
  });

  test.each([
    ['post', '/api/school/homeroom-teachers'],
    ['put', '/api/school/homeroom-teachers/1'],
    ['delete', '/api/school/homeroom-teachers/1'],
  ])('grade teacher cannot %s (403)', async (method, url) => {
    mockUser = { id: 4, role: 'school', scopeId: 'S1', gradeScope: 'ป.1' };
    const res = await request()[method](url).send({ grade: 'ป.1', teacher_name: 'x' });
    expect(res.status).toBe(403);
    expect(routeSvc.addTeacher).not.toHaveBeenCalled();
    expect(routeSvc.updateTeacher).not.toHaveBeenCalled();
    expect(routeSvc.deleteTeacher).not.toHaveBeenCalled();
  });

  test('grade teacher may read, limited to their grade, without edit rights', async () => {
    mockUser = { id: 4, role: 'school', scopeId: 'S1', gradeScope: 'ป.1' };
    const res = await request().get('/api/school/homeroom-teachers');
    expect(res.status).toBe(200);
    expect(res.body.data.can_edit).toBe(false);
    const { grades } = routeSvc.listRooms.mock.calls[0][2];
    expect(grades).toContain('ป.1');
  });

  test('flag off: every endpoint answers 404 and nothing runs', async () => {
    routeSvc.enabled.mockReturnValue(false);
    expect((await request().get('/api/school/homeroom-teachers')).status).toBe(404);
    expect((await request().post('/api/school/homeroom-teachers').send({ grade: 'ป.1', teacher_name: 'x' })).status).toBe(404);
    expect(routeSvc.listRooms).not.toHaveBeenCalled();
    expect(routeSvc.addTeacher).not.toHaveBeenCalled();
  });
});
