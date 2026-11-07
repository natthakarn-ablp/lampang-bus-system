'use strict';

// DP-04: a deactivated line_bindings row (is_active = FALSE) must not grant
// the parent read API access to children.
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));

const { pool } = require('../src/config/database');
const lineSvc = require('../src/services/line.service');

beforeEach(() => {
  pool.query.mockReset();
  pool.query.mockResolvedValue([[]]);
});

describe('line_bindings.is_active is honoured by parent read helpers', () => {
  test('getBoundPhoneByLineUserId filters inactive bindings', async () => {
    await lineSvc.getBoundPhoneByLineUserId('U1');
    expect(pool.query.mock.calls[0][0]).toMatch(/is_active\s*=\s*TRUE/i);
  });

  test('getChildrenByBoundPhone filters inactive bindings', async () => {
    await lineSvc.getChildrenByBoundPhone('U1');
    expect(pool.query.mock.calls[0][0]).toMatch(/lb\.is_active\s*=\s*TRUE/i);
  });

  test('getLinkedParentId resolves no parent via an inactive binding', async () => {
    // Emulate the DB: the binding lookup only returns a row when the SQL
    // filters on is_active (the stored row is inactive).
    pool.query.mockImplementation(async (sql) => {
      if (/FROM line_bindings/i.test(sql)) {
        return /is_active\s*=\s*TRUE/i.test(sql) ? [[]] : [[{ phone: '0811110004' }]];
      }
      if (/FROM parents/i.test(sql)) return [[{ id: 7 }]];
      return [[]];
    });
    expect(await lineSvc.getLinkedParentId('U1')).toBeNull();
  });
});
