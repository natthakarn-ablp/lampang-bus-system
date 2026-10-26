'use strict';

jest.mock('../src/config/database', () => ({
  pool: { query: jest.fn(), getConnection: jest.fn() },
}));

const { pool } = require('../src/config/database');
const service = require('../src/services/affiliation.service');

beforeEach(() => jest.resetAllMocks());

function reportConnection({ schools = [], totalVehicles = '0', affiliation = { id: 'AFF1', name: 'สังกัดลำปาง' } } = {}) {
  const connection = {
    query: jest.fn(async (sql) => {
      if (/FROM affiliations/.test(sql)) return [[affiliation].filter(Boolean)];
      if (/AS total_vehicles/.test(sql)) return [[{ total_vehicles: totalVehicles }]];
      if (/AS student_count/.test(sql)) return [schools];
      return [[]];
    }),
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    release: jest.fn(),
  };
  pool.getConnection.mockResolvedValue(connection);
  return connection;
}

test('report uses one read-only repeatable-read snapshot with numeric school totals and a distinct fleet total', async () => {
  const connection = reportConnection({
    schools: [
      { id: 'SCH1', name: 'โรงเรียนหนึ่ง', student_count: '12', vehicle_count: '2', last_login_at: null },
      { id: 'SCH2', name: 'โรงเรียนสอง', student_count: '3', vehicle_count: '2', last_login_at: null },
      { id: 'SCH0', name: 'โรงเรียนไม่มีนักเรียน', student_count: '0', vehicle_count: '0', last_login_at: null },
    ],
    totalVehicles: '3',
  });
  const before = Date.now();
  const report = await service.getSchoolsReport('AFF1');

  expect(report.affiliation).toEqual({ id: 'AFF1', name: 'สังกัดลำปาง' });
  expect(report.summary).toEqual({ total_schools: 3, total_students: 15, total_vehicles: 3 });
  expect(report.schools.map(row => [row.student_count, row.vehicle_count])).toEqual([[12, 2], [3, 2], [0, 0]]);
  expect(report.schools[0]).toEqual(expect.objectContaining({ id: 'SCH1', last_login_at: null }));
  expect(new Date(report.generated_at).toISOString()).toBe(report.generated_at);
  expect(Date.parse(report.generated_at)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(report.generated_at)).toBeLessThanOrEqual(Date.now());
  expect(connection.query.mock.calls.slice(0, 2).map(([sql]) => sql.replace(/\s+/g, ' ').trim())).toEqual([
    'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
    'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY',
  ]);
  const reads = connection.query.mock.calls.slice(2);
  expect(reads).toHaveLength(3);
  for (const [, params] of reads) expect(params).toEqual(['AFF1']);
  expect(connection.commit).toHaveBeenCalledTimes(1);
  expect(connection.commit.mock.invocationCallOrder[0]).toBeGreaterThan(connection.query.mock.invocationCallOrder.at(-1));
  expect(connection.release).toHaveBeenCalledTimes(1);
  expect(connection.rollback).not.toHaveBeenCalled();
  expect(pool.query).not.toHaveBeenCalled();
  expect(JSON.stringify(report)).not.toMatch(/student_id|first_name|last_name|parent_phone/);
});

test.each(['start', 'affiliation', 'schools', 'vehicles', 'commit'])('report rolls back and releases when %s fails', async (stage) => {
  const connection = reportConnection();
  const failure = new Error(`${stage} unavailable`);
  if (stage === 'commit') connection.commit.mockRejectedValueOnce(failure);
  else {
    const respond = connection.query.getMockImplementation();
    const match = { start: /START TRANSACTION/, affiliation: /FROM affiliations/, schools: /AS student_count/, vehicles: /AS total_vehicles/ }[stage];
    connection.query.mockImplementation((sql, params) => match.test(sql) ? Promise.reject(failure) : respond(sql, params));
  }

  await expect(service.getSchoolsReport('AFF1')).rejects.toBe(failure);
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.release).toHaveBeenCalledTimes(1);
  expect(connection.release.mock.invocationCallOrder[0]).toBeGreaterThan(connection.rollback.mock.invocationCallOrder[0]);
  if (stage !== 'commit') expect(connection.commit).not.toHaveBeenCalled();
});

test('rollback failure does not mask the read error or prevent release', async () => {
  const connection = reportConnection();
  const failure = new Error('read unavailable');
  connection.query.mockRejectedValueOnce(failure);
  connection.rollback.mockRejectedValueOnce(new Error('rollback unavailable'));
  await expect(service.getSchoolsReport('AFF1')).rejects.toBe(failure);
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.release).toHaveBeenCalledTimes(1);
});

test('a missing or deleted affiliation is not returned as a report', async () => {
  const connection = reportConnection({ affiliation: null });
  await expect(service.getSchoolsReport('MISSING')).rejects.toMatchObject({ statusCode: 404 });
  expect(connection.rollback).toHaveBeenCalledTimes(1);
  expect(connection.commit).not.toHaveBeenCalled();
  expect(connection.release).toHaveBeenCalledTimes(1);
});

test('an existing affiliation with no schools returns an empty current-data report', async () => {
  reportConnection();
  const report = await service.getSchoolsReport('AFF1');
  expect(report.summary).toEqual({ total_schools: 0, total_students: 0, total_vehicles: 0 });
  expect(report.schools).toEqual([]);
  expect(report.affiliation.id).toBe('AFF1');
  expect(report).not.toHaveProperty('submission_status');
});

test('fleet query is scoped and parameterized with all soft-delete filters and no student PII', async () => {
  const connection = reportConnection();
  const affiliationId = "AFF1' OR 1=1 --";
  await service.getSchoolsReport(affiliationId);
  const [sql, params] = connection.query.mock.calls.find(([statement]) => /AS total_vehicles/.test(statement));
  expect(sql).toMatch(/COUNT\(DISTINCT s\.vehicle_id\)/);
  expect(sql).toMatch(/JOIN schools sc ON sc\.id = s\.school_id AND sc\.is_deleted = FALSE/);
  expect(sql).toMatch(/JOIN vehicles v ON v\.id = s\.vehicle_id AND v\.is_deleted = FALSE/);
  expect(sql).toMatch(/WHERE sc\.affiliation_id = \? AND s\.is_deleted = FALSE/);
  expect(sql).not.toContain(affiliationId);
  expect(params).toEqual([affiliationId]);
  const [affiliationSql, affiliationParams] = connection.query.mock.calls.find(([statement]) => /FROM affiliations/.test(statement));
  expect(affiliationSql).toMatch(/WHERE id = \? AND is_deleted = FALSE/);
  expect(affiliationParams).toEqual([affiliationId]);
  for (const [statement] of connection.query.mock.calls) {
    expect(statement).not.toMatch(/first_name|last_name|parent_phone|s\.id\b|s\.\*/);
  }
});

test('connection acquisition failure propagates without pool queries', async () => {
  const failure = new Error('pool unavailable');
  pool.getConnection.mockRejectedValueOnce(failure);
  await expect(service.getSchoolsReport('AFF1')).rejects.toBe(failure);
  expect(pool.query).not.toHaveBeenCalled();
});

test('school counts can reuse a supplied executor without querying the pool', async () => {
  const rows = [{ id: 'SCH1', name: 'โรงเรียนทดสอบ', student_count: '0', vehicle_count: '0' }];
  const connection = { query: jest.fn().mockResolvedValue([rows]) };
  pool.query.mockResolvedValue([[]]);

  expect(await service.getSchools('AFF1', connection)).toBe(rows);
  expect(pool.query).not.toHaveBeenCalled();
  const [sql, params] = connection.query.mock.calls[0];
  expect(params).toEqual(['AFF1']);
  expect(sql).toMatch(/sc\.affiliation_id = \? AND sc\.is_deleted = FALSE/);
  expect(sql).toMatch(/s\.is_deleted = FALSE/);
  expect(sql).toMatch(/JOIN vehicles v ON v\.id = s\.vehicle_id AND v\.is_deleted = FALSE/);
});
