'use strict';

/**
 * driverReactivation.test.js  (Phase 10.13A-23C)
 *
 * ISOLATED — mocked pool. Verifies detectDriverReactivationBlock blocks the
 * dedupe-disabled / broken driver accounts (358/369/408 patterns, incl. the
 * soft-deleted-canonical case) and lets a legitimate, non-duplicate driver
 * through.
 */

const { detectDriverReactivationBlock } = require('../src/utils/driverReactivation');

// Drive the 2 queries: (1) linked sibling driver users, (2) active vehicle.
function makePool({ siblings = [], activeVeh = [] } = {}) {
  return {
    query: jest.fn(async (sql) => {
      if (/driver_id IS NOT NULL/.test(sql)) return [siblings];   // linked canonical siblings
      if (/FROM vehicles/.test(sql)) return [activeVeh];          // active vehicle
      return [[]];
    }),
  };
}

describe('detectDriverReactivationBlock (10.13A-23C)', () => {
  test('369-like → DUPLICATE_OF_LINKED_DRIVER (canonical 368)', async () => {
    const pool = makePool({ siblings: [{ id: 368, n: 'นข1365ลำปาง' }] });
    const r = await detectDriverReactivationBlock(pool, { id: 369, username: 'นข 1365 ลำปาง' });
    expect(r).toEqual({ blocked: true, reason: 'DUPLICATE_OF_LINKED_DRIVER', canonicalUserId: 368 });
  });

  test('408-like → blocked even though canonical 407 is soft-deleted (still linked)', async () => {
    // 407 is soft-deleted but driver_id=144 → still a linked sibling.
    const pool = makePool({ siblings: [{ id: 407, n: 'บน1467' }] });
    const r = await detectDriverReactivationBlock(pool, { id: 408, username: 'บน 1467' });
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('DUPLICATE_OF_LINKED_DRIVER');
    expect(r.canonicalUserId).toBe(407);
  });

  test('358-like → PROVINCE_VARIANT_OF_LINKED_DRIVER (canonical 363)', async () => {
    const pool = makePool({ siblings: [{ id: 363, n: 'นข4031ลำปาง' }], activeVeh: [] });
    const r = await detectDriverReactivationBlock(pool, { id: 358, username: 'นข4031' });
    expect(r.blocked).toBe(true);
    expect(r.reason).toBe('PROVINCE_VARIANT_OF_LINKED_DRIVER');
    expect(r.canonicalUserId).toBe(363);
  });

  test('no linked sibling, no active vehicle → NO_ACTIVE_VEHICLE warning, NOT blocked (10.13C)', async () => {
    const pool = makePool({ siblings: [], activeVeh: [] });
    const r = await detectDriverReactivationBlock(pool, { id: 999, username: 'ขข 9 ลำปาง' });
    expect(r.blocked).toBe(false);
    expect(r.warning).toBe(true);
    expect(r.reason).toBe('NO_ACTIVE_VEHICLE');
  });

  test('legitimate driver (active vehicle, no linked duplicate) → NOT blocked', async () => {
    const pool = makePool({ siblings: [{ id: 500, n: 'อื่น9999' }], activeVeh: [{ id: 'V-real' }] });
    const r = await detectDriverReactivationBlock(pool, { id: 600, username: 'นข 7777 ลำปาง' });
    expect(r.blocked).toBe(false);
    expect(r.canonicalUserId).toBe(null);
  });

  test('the canonical itself (no OTHER linked sibling, active vehicle) → NOT blocked', async () => {
    // Reactivating the canonical: its only same-plate sibling is the UNLINKED
    // duplicate (driver_id NULL), which is excluded from the linked-sibling query.
    const pool = makePool({ siblings: [], activeVeh: [{ id: 'V-30ae' }] });
    const r = await detectDriverReactivationBlock(pool, { id: 363, username: 'นข 4031 ลำปาง' });
    expect(r.blocked).toBe(false);
  });

  test('empty/blank username → NOT blocked (defensive)', async () => {
    const r = await detectDriverReactivationBlock(makePool(), { id: 1, username: '' });
    expect(r.blocked).toBe(false);
  });
});
