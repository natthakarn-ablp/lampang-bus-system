'use strict';

let mockUser;
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; next(); },
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/services/affiliation.service', () => ({ getSchoolsReport: jest.fn(), getSchools: jest.fn() }));

const express = require('express');
const request = require('supertest');
const ExcelJS = require('exceljs');
const service = require('../src/services/affiliation.service');
const routes = require('../src/routes/affiliation.routes');

const instance = express();
instance.use('/api/affiliation', routes);
instance.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false }));

const report = {
  affiliation: { id: 'AFF1', name: 'สังกัดลำปาง' },
  generated_at: '2026-10-21T01:02:03.000Z',
  summary: { total_schools: 3, total_students: 15, total_vehicles: 3 },
  schools: [
    { id: 'SCH1', name: 'โรงเรียนหนึ่ง', student_count: 12, vehicle_count: 2, last_login_at: null },
    { id: 'SCH2', name: '=HYPERLINK("https://invalid.test","โรงเรียนสอง")', student_count: 3, vehicle_count: 2, last_login_at: null },
    { id: 'SCH0', name: 'โรงเรียนไม่มีนักเรียน', student_count: 0, vehicle_count: 0, last_login_at: null },
  ],
};

beforeEach(() => {
  jest.resetAllMocks();
  mockUser = { id: 1, role: 'affiliation', scopeId: 'AFF1' };
  service.getSchoolsReport.mockResolvedValue(report);
  service.getSchools.mockResolvedValue(report.schools);
});

function binaryParser(response, callback) {
  const chunks = [];
  response.on('data', chunk => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', callback);
}

test('Excel report roundtrips Thai text, literal formula-like names, zero rows and deduplicated numeric summary', async () => {
  const excelReport = { ...report, affiliation: { ...report.affiliation, name: '=1+1 สังกัดลำปาง' } };
  service.getSchoolsReport.mockResolvedValueOnce(excelReport);
  const response = await request(instance)
    .get('/api/affiliation/schools/report/excel?affiliation_id=OTHER')
    .buffer(true).parse(binaryParser);

  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toMatch(/^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
  expect(response.headers['content-disposition']).toMatch(/attachment; filename="[a-zA-Z0-9_.-]+\.xlsx"/);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body.subarray(0, 2).toString()).toBe('PK');
  expect(service.getSchoolsReport).toHaveBeenCalledWith('AFF1');
  expect(service.getSchools).not.toHaveBeenCalled();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.body);
  const sheet = workbook.worksheets[0];
  expect(sheet.getCell('A1').value).toContain('ข้อมูลปัจจุบัน');
  expect(sheet.getCell('B2').value).toBe(excelReport.affiliation.name);
  expect(sheet.getCell('B3').value).toBe(report.generated_at);
  expect(sheet.getCell('B4').value).toBe(3);
  expect(sheet.getCell('A5').value).toContain('ไม่ใช่สถานะการส่งรายงาน');
  expect(sheet.getCell('A5').value).toContain('ศูนย์');
  expect(sheet.getCell('A6').value).toContain('นับไม่ซ้ำ');
  expect(sheet.getCell('A6').value).toContain('น้อยกว่าผลรวมรายโรงเรียน');
  expect(sheet.getRow(8).values.slice(1)).toEqual(['รหัสโรงเรียน', 'ชื่อโรงเรียน', 'จำนวนนักเรียน (คน)', 'จำนวนรถรับส่ง (คัน)']);
  for (let index = 0; index < report.schools.length; index++) {
    const school = report.schools[index];
    expect(sheet.getRow(9 + index).values.slice(1)).toEqual([school.id, school.name, school.student_count, school.vehicle_count]);
    expect(sheet.getCell(9 + index, 3).type).toBe(ExcelJS.ValueType.Number);
    expect(sheet.getCell(9 + index, 4).type).toBe(ExcelJS.ValueType.Number);
  }
  expect(sheet.lastRow.values.slice(1)).toEqual(['รวม', '3 โรงเรียน', 15, 3]);
  sheet.eachRow(row => row.eachCell(cell => {
    expect(cell.type).not.toBe(ExcelJS.ValueType.Formula);
    expect(cell.formula).toBeUndefined();
  }));
});

test.each(['', '/excel'])('report%s denies unauthenticated callers', async suffix => {
  mockUser = undefined;
  const response = await request(instance).get(`/api/affiliation/schools/report${suffix}`);
  expect(response.status).toBe(401);
  expect(service.getSchoolsReport).not.toHaveBeenCalled();
});

describe.each(['', '/excel'])('report%s scope and errors', suffix => {
  test.each(['school', 'driver', 'province'])('denies the %s role before reading data', async role => {
    mockUser.role = role;
    const response = await request(instance).get(`/api/affiliation/schools/report${suffix}?affiliation_id=AFF2`);
    expect(response.status).toBe(403);
    expect(service.getSchoolsReport).not.toHaveBeenCalled();
  });

  test('query cannot supply a missing affiliation account scope', async () => {
    mockUser.scopeId = null;
    const response = await request(instance).get(`/api/affiliation/schools/report${suffix}?affiliation_id=AFF2`);
    expect(response.status).toBe(403);
    expect(service.getSchoolsReport).not.toHaveBeenCalled();
  });

  test('admin must explicitly choose an affiliation rather than using account scope', async () => {
    mockUser.role = 'admin';
    const response = await request(instance).get(`/api/affiliation/schools/report${suffix}`);
    expect(response.status).toBe(403);
    expect(service.getSchoolsReport).not.toHaveBeenCalled();
  });

  test('admin reads only the explicitly selected affiliation', async () => {
    mockUser.role = 'admin';
    const response = await request(instance).get(`/api/affiliation/schools/report${suffix}?affiliation_id=AFF2`);
    expect(response.status).toBe(200);
    expect(service.getSchoolsReport).toHaveBeenCalledTimes(1);
    expect(service.getSchoolsReport).toHaveBeenCalledWith('AFF2');
  });

  test.each([404, 500])('service errors propagate as %s without an attachment', async statusCode => {
    service.getSchoolsReport.mockRejectedValueOnce(Object.assign(new Error('report unavailable'), { statusCode }));
    const response = await request(instance).get(`/api/affiliation/schools/report${suffix}`);
    expect(response.status).toBe(statusCode);
    expect(response.body).toEqual({ success: false });
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['content-disposition']).toBeUndefined();
  });
});

test('legacy schools endpoint keeps the original list response and scoped service', async () => {
  const response = await request(instance).get('/api/affiliation/schools?affiliation_id=OTHER');
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual(report.schools);
  expect(service.getSchools).toHaveBeenCalledWith('AFF1');
  expect(service.getSchoolsReport).not.toHaveBeenCalled();
});

test('Excel for an empty affiliation still has metadata, headers and a numeric zero summary', async () => {
  service.getSchoolsReport.mockResolvedValueOnce({
    ...report, schools: [], summary: { total_schools: 0, total_students: 0, total_vehicles: 0 },
  });
  const response = await request(instance).get('/api/affiliation/schools/report/excel').buffer(true).parse(binaryParser);
  expect(response.status).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.body);
  const sheet = workbook.worksheets[0];
  expect(sheet.getCell('B2').value).toBe(report.affiliation.name);
  expect(sheet.getCell('B4').value).toBe(0);
  expect(sheet.getCell('A8').value).toBe('รหัสโรงเรียน');
  expect(sheet.lastRow.number).toBe(9);
  expect(sheet.lastRow.values.slice(1)).toEqual(['รวม', '0 โรงเรียน', 0, 0]);
  expect(sheet.lastRow.getCell(3).type).toBe(ExcelJS.ValueType.Number);
  expect(sheet.lastRow.getCell(4).type).toBe(ExcelJS.ValueType.Number);
});

test('all formula-like text remains literal XLSX strings and identifiers retain leading zeros', async () => {
  const names = ['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)', '\t=1+1', '\r=1+1'];
  const schools = names.map(name => ({ id: '00123', name, student_count: 0, vehicle_count: 0 }));
  service.getSchoolsReport.mockResolvedValueOnce({
    ...report, schools, summary: { total_schools: schools.length, total_students: 0, total_vehicles: 0 },
  });
  const response = await request(instance).get('/api/affiliation/schools/report/excel').buffer(true).parse(binaryParser);
  expect(response.status).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.body);
  const sheet = workbook.worksheets[0];
  names.forEach((name, index) => {
    expect(sheet.getCell(9 + index, 1).value).toBe('00123');
    // XML normalizes carriage returns to LF, but the cell must remain text.
    expect(sheet.getCell(9 + index, 2).value).toBe(name.replace(/\r/g, '\n'));
    expect(sheet.getCell(9 + index, 2).type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell(9 + index, 2).formula).toBeUndefined();
  });
});

test('JSON school report returns the agreed envelope and cannot override affiliation account scope', async () => {
  const response = await request(instance).get('/api/affiliation/schools/report?affiliation_id=OTHER');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ success: true, message: 'OK', data: report });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(service.getSchoolsReport).toHaveBeenCalledWith('AFF1');
  expect(service.getSchools).not.toHaveBeenCalled();
});
