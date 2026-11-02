'use strict';
require('./loadTestEnv');
const { getTestConnection } = require('./dbHelper');
let mockActorId;
jest.mock('../src/middleware/auth', () => ({ authenticate: (req, _res, next) => {
  req.user = { id: mockActorId, role: 'school', scopeId: '__GPES1', gradeScope: 'ป.5' };
  next();
} }));
const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/database');
const app = express();
app.use(express.json());
app.use('/api/school', require('../src/routes/school.routes'));
app.use(require('../src/middleware/errorHandler'));
const sharedVehicle = 'V-gpe00000001';
const ownStudents = [];
const parentIds = new Set();
let originalParent;
const db = getTestConnection;

beforeAll(async () => {
  const c = await db();
  try {
    const [[actor]] = await c.query("SELECT id FROM users WHERE username = '__test_school'");
    mockActorId = actor.id;
    await c.query("INSERT INTO schools (id,name,affiliation_id) VALUES ('__GPES1','__GPE school1','__TAFF'),('__GPES2','__GPE school2','__TAFF')");
    await c.query("INSERT INTO vehicles (id,plate_no,normalized_plate,vehicle_type,owner_phone) VALUES (?, '__GPE vehicle', '__gpevehicle', 'รถตู้', '0800000001')", [sharedVehicle]);
    const [[{ maxId }]] = await c.query('SELECT COALESCE(MAX(id),0) AS maxId FROM students');
    for (const [index, school, grade] of [[1, '__GPES1', 'ป.5'], [2, '__GPES1', 'ป.6'], [3, '__GPES2', 'ป.5']]) {
      const id = Number(maxId) + 100 + index;
      await c.query(
        `INSERT INTO students (id,cid_hash,prefix,first_name,last_name,grade,classroom,school_id,vehicle_id,morning_enabled,evening_enabled,term_id)
         VALUES (?,SHA2(?,256),'เด็กชาย','__GPE_original','Test',?,'1',?,?,TRUE,TRUE,'2568-2')`,
        [id, `__gpe_pupil_${index}`, grade, school, sharedVehicle]
      );
      ownStudents.push(id);
    }
    const [p] = await c.query("INSERT INTO parents (name,phone,line_user_id) VALUES ('__GPE_parent','0800000000','__GPE_fake_line')");
    originalParent = p.insertId; parentIds.add(originalParent);
    for (const id of ownStudents.slice(0, 2)) await c.query('INSERT INTO parent_student (parent_id,student_id,approved,approved_by,approved_at) VALUES (?,?,TRUE,?,NOW())', [originalParent, id, mockActorId]);
  } finally { await c.end(); }
});

beforeEach(async () => {
  const c = await db();
  try {
    await c.query("UPDATE students SET grade='ป.5',first_name='__GPE_original',classroom='1',school_id='__GPES1',vehicle_id=? WHERE id=?", [sharedVehicle, ownStudents[0]]);
    await c.query('DELETE FROM parent_student WHERE student_id=?', [ownStudents[0]]);
    await c.query('INSERT INTO parent_student (parent_id,student_id,approved,approved_by,approved_at) VALUES (?,?,TRUE,?,NOW())', [originalParent, ownStudents[0], mockActorId]);
    await c.query("UPDATE vehicles SET vehicle_type='รถตู้',owner_phone='0800000001' WHERE id=?", [sharedVehicle]);
  } finally { await c.end(); }
});

afterEach(async () => {
  if (!ownStudents.length) return;
  const c = await db();
  try { const [links] = await c.query('SELECT parent_id FROM parent_student WHERE student_id=?', [ownStudents[0]]); links.forEach(link => parentIds.add(link.parent_id)); }
  finally { await c.end(); }
});

afterAll(async () => {
  const c = await db();
  try {
    if (ownStudents.length) {
      await c.query("DELETE FROM audit_logs WHERE entity_type='student' AND entity_id IN (?)", [ownStudents.map(String)]);
      await c.query('DELETE FROM parent_student WHERE student_id IN (?)', [ownStudents]);
      await c.query('DELETE FROM students WHERE id IN (?)', [ownStudents]);
    }
    if (parentIds.size) await c.query('DELETE FROM parents WHERE id IN (?)', [[...parentIds]]);
    await c.query("DELETE FROM audit_logs WHERE entity_type='vehicle' AND entity_id=?", [sharedVehicle]);
    await c.query('DELETE FROM vehicles WHERE id=?', [sharedVehicle]);
    await c.query("DELETE FROM schools WHERE id IN ('__GPES1','__GPES2')");
  } finally { await c.end(); }
});

test('real SQL permits own-grade edits and preserves an omitted private phone and guardian link', async () => {
  const c = await db();
  try {
    await c.query("UPDATE students SET grade='ประถมศึกษาปีที่ 5' WHERE id=?", [ownStudents[0]]);
    const res = await request(app).put(`/api/school/students/${ownStudents[0]}`).send({ first_name: '__GPE_updated', classroom: '2' });
    expect(res.status).toBe(200);
    const [[row]] = await c.query('SELECT s.first_name,s.classroom,ps.parent_id,p.phone FROM students s JOIN parent_student ps ON ps.student_id=s.id JOIN parents p ON p.id=ps.parent_id WHERE s.id=?', [ownStudents[0]]);
    expect(row).toEqual({ first_name: '__GPE_updated', classroom: '2', parent_id: originalParent, phone: '0800000000' });
    const [[audit]] = await c.query("SELECT COUNT(*) AS n FROM audit_logs WHERE entity_type='student' AND entity_id=? AND user_id=?", [String(ownStudents[0]), mockActorId]);
    expect(Number(audit.n)).toBeGreaterThan(0);
  } finally { await c.end(); }
});

test('real SQL denies another grade and school and prevents moving own pupil outside assigned grade', async () => {
  for (const id of ownStudents.slice(1)) expect((await request(app).put(`/api/school/students/${id}`).send({ first_name: '__GPE_denied' })).status).toBe(404);
  expect((await request(app).put(`/api/school/students/${ownStudents[0]}`).send({ grade: 'ป.6' })).status).toBe(403);
  const c = await db();
  try { const [rows] = await c.query('SELECT first_name FROM students WHERE id IN (?)', [ownStudents]); expect(rows.every(row => row.first_name === '__GPE_original')).toBe(true); }
  finally { await c.end(); }
});

test('real guardian reassignment affects only the pupil, preserves sibling link, and does not copy LINE identity', async () => {
  const res = await request(app).put(`/api/school/students/${ownStudents[0]}`).send({ parent_name: '__GPE_new_parent' });
  expect(res.status).toBe(200); expect(res.body.data.parent_reassigned).toBe(true);
  const c = await db();
  try {
    const [[newLink]] = await c.query('SELECT ps.parent_id,p.name,p.phone,p.line_user_id FROM parent_student ps JOIN parents p ON p.id=ps.parent_id WHERE ps.student_id=?', [ownStudents[0]]);
    parentIds.add(newLink.parent_id);
    expect(newLink.parent_id).not.toBe(originalParent); expect(newLink.name).toBe('__GPE_new_parent'); expect(newLink.phone).toBe('0800000000'); expect(newLink.line_user_id).toBeNull();
    const [[sibling]] = await c.query('SELECT parent_id FROM parent_student WHERE student_id=?', [ownStudents[1]]);
    expect(sibling.parent_id).toBe(originalParent);
  } finally { await c.end(); }
});

test('real shared-master vehicle edit is allowed with own-grade rider and denied after its link is removed', async () => {
  const url = `/api/school/vehicles/${sharedVehicle}`;
  expect((await request(app).put(url).send({ vehicle_type: 'รถสองแถว' })).status).toBe(200);
  const c = await db();
  try {
    const [[v]] = await c.query('SELECT vehicle_type,owner_phone FROM vehicles WHERE id=?', [sharedVehicle]);
    expect(v).toEqual({ vehicle_type: 'รถสองแถว', owner_phone: '0800000001' });
    await c.query('UPDATE students SET vehicle_id=NULL WHERE id=?', [ownStudents[0]]);
    expect((await request(app).put(url).send({ vehicle_type: 'รถบัส' })).status).toBe(404);
    const [[unchanged]] = await c.query('SELECT vehicle_type FROM vehicles WHERE id=?', [sharedVehicle]);
    expect(unchanged.vehicle_type).toBe('รถสองแถว');
  } finally { await c.end(); }
});

test('a concurrent grade move before locked recheck prevents profile and guardian mutation', async () => {
  const writer = await db();
  const originalQuery = pool.query.bind(pool);
  let notifyRead;
  const readStarted = new Promise(resolve => { notifyRead = resolve; });
  const spy = jest.spyOn(pool, 'query').mockImplementation(async (...args) => {
    const result = await originalQuery(...args);
    if (String(args[0]).includes('FROM students s') && args[1]?.[0] === ownStudents[0]) notifyRead();
    return result;
  });
  try {
    await writer.beginTransaction();
    await writer.query('SELECT id FROM students WHERE id=? FOR UPDATE', [ownStudents[0]]);
    const response = request(app).put(`/api/school/students/${ownStudents[0]}`).send({ first_name: '__GPE_race', parent_name: '__GPE_race_parent' }).then(res => res);
    await readStarted;
    await writer.query("UPDATE students SET grade='ป.6' WHERE id=?", [ownStudents[0]]);
    await writer.commit();
    expect((await response).status).toBe(409);
    const [[row]] = await writer.query('SELECT first_name FROM students WHERE id=?', [ownStudents[0]]);
    expect(row.first_name).toBe('__GPE_original');
    const [[link]] = await writer.query('SELECT parent_id FROM parent_student WHERE student_id=?', [ownStudents[0]]);
    expect(link.parent_id).toBe(originalParent);
  } finally { spy.mockRestore(); await writer.rollback(); await writer.end(); }
}, 20000);
