'use strict';
// SB-A2-03: ETA for a shared vehicle must not list pickup points that hold
// only another school's (or affiliation's) pupils. Same rule as AUD-SCH-01.
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(async () => [[]]) } }));
const env = require('../src/config/env');
const { pool } = require('../src/config/database');
const eta = require('../src/services/eta.service');

beforeAll(() => { env.features.eta = true; });
beforeEach(() => pool.query.mockClear());

const lastCall = () => pool.query.mock.calls[pool.query.mock.calls.length - 1];

test('school scope adds the visibility filter with the school id', async () => {
  await eta.getForVehicle(7, { session: 'morning', schoolId: 'SCH1', now: new Date('2026-11-11T01:00:00Z') });
  const [sql, params] = lastCall();
  expect(sql).toMatch(/NOT EXISTS/);
  expect(sql).toMatch(/s\.school_id = \?/);
  expect(params).toEqual([7, 'morning', expect.any(String), 'SCH1', 'SCH1']);
});

test('affiliation scope filters by the affiliation\'s schools', async () => {
  await eta.getForVehicle(7, { session: 'morning', affiliationId: 'AFF001' });
  const [sql, params] = lastCall();
  expect(sql).toMatch(/affiliation_id = \?/);
  expect(params.slice(-2)).toEqual(['AFF001', 'AFF001']);
});

test('admin/province/driver (no scope) query is unchanged', async () => {
  await eta.getForVehicle(7, { session: 'evening' });
  const [sql, params] = lastCall();
  expect(sql).not.toMatch(/NOT EXISTS/);
  expect(params).toHaveLength(3);
});
