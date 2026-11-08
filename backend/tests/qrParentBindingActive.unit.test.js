'use strict';

// P-08 (parent audit 2026-11-08): the QR Level-2 parent check must ignore a
// deactivated line_bindings row, like every other parent read path (DP-04).
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue() }));
jest.mock('../src/config/env', () => ({ features: { qrLevel3: false, qrEmergencyContactSource: 'driver' } }));

const { pool } = require('../src/config/database');
const qr = require('../src/services/qrAccess.service');

test('isParentLinkedToVehicle does not match through an inactive binding', async () => {
  // Emulate the DB: the stored binding is inactive, so a row only comes back
  // when the SQL forgets to filter on lb.is_active.
  pool.query.mockImplementation(async (sql) =>
    (/lb\.is_active\s*=\s*TRUE/i.test(sql) ? [[]] : [[{ ok: 1 }]]));
  expect(await qr.isParentLinkedToVehicle('U1', 'V-000000000001')).toBe(false);
});
