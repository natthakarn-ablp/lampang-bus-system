'use strict';

// GET /api/school/students/export — Excel of the student list with the same
// filters as GET /students. Teacher pinned to their grade; no parent contact
// in the file; audit-logged before bytes.
require('./loadTestEnv');
let mockUser;
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { ...mockUser }; next(); },
}));
const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({ pool: { query: (...a) => mockQuery(...a), getConnection: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));

const ExcelJS = require('exceljs');
const express = require('express');
const request = require('supertest');
const { logAudit } = require('../src/utils/audit');
const app = express();
app.use(express.json());
app.use('/api/school', require('../src/routes/school.routes'));
app.use(require('../src/middleware/errorHandler'));

const SCHOOL = { id: 1, role: 'school', scopeId: 'SCH1', gradeScope: null };
const TEACHER = { id: 2, role: 'school', scopeId: 'SCH1', gradeScope: 'ป.1' };
const ROWS = [
  { id: 101, prefix: 'ด.ช.', first_name: 'ก', last_name: 'ข', grade: 'ป.1', classroom: '1', vehicle_id: 'V-aaaaaaaaaaaa', plate_no: 'กข 1', morning_enabled: 1, evening_enabled: 0, parent_name: 'ผู้ปกครอง', parent_phone: '0812345678', dropoff_address: 'บ้าน', parent_line_linked: 0 },
  { id: 102, prefix: 'ด.ญ.', first_name: '=HYPERLINK("x")', last_name: 'ง', grade: 'ประถมศึกษาปีที่ 1', classroom: '2', vehicle_id: null, plate_no: null, morning_enabled: 1, evening_enabled: 1, parent_name: null, parent_phone: null, dropoff_address: null, parent_line_linked: 0 },
];

function fakeDb(rows = ROWS) {
  mockQuery.mockImplementation(async (sql) => {
    const s = String(sql);
    if (/COUNT\(\*\) AS total FROM students/.test(s)) return [[{ total: rows.length }]];
    if (/FROM students s/.test(s)) return [rows];
    if (/FROM student_pickup_points spp/.test(s)) return [[{ student_id: 101, label: 'หน้าวัด', session: 'morning' }]];
    return [[]];
  });
}

async function getXlsx(url) {
  const res = await request(app).get(url).buffer(true)
    .parse((r, cb) => { const b = []; r.on('data', c => b.push(c)); r.on('end', () => cb(null, Buffer.concat(b))); });
  return res;
}

beforeEach(() => { mockQuery.mockReset(); logAudit.mockClear(); });

test('school export: workbook with expected columns, no parent contact, audited', async () => {
  mockUser = SCHOOL; fakeDb();
  const res = await getXlsx('/api/school/students/export?has_vehicle=yes&search=ก');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body);
  const ws = wb.getWorksheet('รายชื่อนักเรียน');
  expect(ws.getRow(1).values.slice(1)).toEqual(['รหัสนักเรียน', 'คำนำหน้า', 'ชื่อ', 'นามสกุล', 'สายชั้น', 'ห้อง', 'ทะเบียนรถ', 'รอบเช้า', 'รอบเย็น', 'จุดรับส่ง']);
  expect(ws.getRow(2).values.slice(1)).toEqual([101, 'ด.ช.', 'ก', 'ข', 'ป.1', '1', 'กข 1', 'ใช้', '-', 'หน้าวัด (เช้า)']);
  expect(ws.getRow(3).getCell(5).value).toBe('ป.1');
  expect(ws.getRow(3).getCell(7).value).toBe('ยังไม่ผูกรถ');
  // a value that looks like a formula stays plain text
  expect(ws.getRow(3).getCell(3).value).toBe('=HYPERLINK("x")');
  expect(ws.getRow(3).getCell(3).formula).toBeUndefined();
  const all = JSON.stringify(ws.getSheetValues());
  expect(all).not.toMatch(/0812345678|ผู้ปกครอง|บ้าน/);
  // filters reached the query
  const listSql = mockQuery.mock.calls.find(c => /FROM students s/.test(String(c[0])) && /LIMIT/.test(String(c[0])));
  expect(String(listSql[0])).toMatch(/vehicle_id IS NOT NULL/);
  expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'student_list_xlsx' }));
});

test('teacher export is pinned to their grade even if another grade is requested', async () => {
  mockUser = TEACHER; fakeDb();
  const res = await getXlsx('/api/school/students/export?grade=ป.6');
  expect(res.status).toBe(200);
  const listSql = mockQuery.mock.calls.find(c => /FROM students s/.test(String(c[0])) && /LIMIT/.test(String(c[0])));
  expect(listSql[1]).toEqual(expect.arrayContaining(['ป.1']));
  expect(listSql[1]).not.toContain('ป.6');
});

test('array-valued filter is rejected', async () => {
  mockUser = SCHOOL; fakeDb();
  const res = await request(app).get('/api/school/students/export?search=a&search=b');
  expect(res.status).toBe(400);
  expect(logAudit).not.toHaveBeenCalled();
});
