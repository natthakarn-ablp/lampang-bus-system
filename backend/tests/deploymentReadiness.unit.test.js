'use strict';

const {
  getDeploymentReadiness,
  section,
} = require('../src/services/deploymentReadiness.service');

// ── Mock pool: dispatch by SQL shape, mirroring safetyPolicy.unit.test.js ────
// The service issues four queries in order:
//   1) vehicle aggregate (FROM vehicles, no JOIN)         — status + capacity + docs
//   2) latest-inspection count (JOIN vehicle_inspections) — passed & not expired
//   3) driver-account aggregate (FROM users ... role='driver')
//   4) assignment aggregate (FROM vehicles ... LEFT JOIN driver_vehicle_assignments)
// Each returns mysql2's [rows] tuple shape: [[ {row} ]].
function fakeAggregatePool(overrides = {}) {
  const vehicle = {
    total: 182,
    status_eligible: 0,
    status_expiring: 0,
    status_unverified: 180,
    status_ineligible: 1,
    status_suspended: 1,
    with_capacity: 0,
    with_valid_documents: 10,
    ...(overrides.vehicle || {}),
  };
  const inspection = { with_passed_inspection: 5, ...(overrides.inspection || {}) };
  const driver = {
    total: 158,
    linked: 141,
    unlinked: 17,
    with_verified_qualification: 0,
    ...(overrides.driver || {}),
  };
  const assignment = {
    total: 182,
    with_authorized_driver: 147,
    with_backup_driver: 0,
    ...(overrides.assignment || {}),
  };

  const calls = [];
  const pool = {
    calls,
    query: jest.fn(async (sql) => {
      calls.push(sql);
      if (/JOIN\s+vehicle_inspections/i.test(sql)) return [[inspection]];
      if (/FROM\s+users/i.test(sql)) return [[driver]];
      if (/LEFT JOIN\s+driver_vehicle_assignments/i.test(sql)) return [[assignment]];
      if (/FROM\s+vehicles/i.test(sql)) return [[vehicle]];
      return [[{}]];
    }),
  };
  return pool;
}

describe('section()', () => {
  test('computes missing and pct', () => {
    expect(section(182, 0)).toMatchObject({ total: 182, ready: 0, missing: 182, pct: 0 });
    expect(section(100, 25)).toMatchObject({ total: 100, ready: 25, missing: 75, pct: 25 });
  });

  test('treats an empty total as 100% ready and never goes negative', () => {
    expect(section(0, 0)).toMatchObject({ total: 0, ready: 0, missing: 0, pct: 100 });
    expect(section(5, 99)).toMatchObject({ total: 5, ready: 5, missing: 0 });
  });
});

describe('getDeploymentReadiness', () => {
  test('returns the aggregate report shape with policy mode and scope', async () => {
    const report = await getDeploymentReadiness(fakeAggregatePool(), { mode: 'OBSERVE' });
    expect(report).toMatchObject({
      policy_mode: 'OBSERVE',
      scope: 'province',
      sections: expect.any(Object),
      status_buckets: expect.any(Array),
      gaps: expect.any(Array),
      hard_gate_count: expect.any(Number),
      warning_count: expect.any(Number),
    });
    expect(typeof report.generated_at).toBe('string');
  });

  test('maps vehicle / driver / assignment counts through to sections', async () => {
    const report = await getDeploymentReadiness(fakeAggregatePool(), { mode: 'OBSERVE' });
    expect(report.sections.vehicles).toMatchObject({ total: 182, ready: 0, missing: 182 });
    expect(report.sections.vehicles.by_status).toMatchObject({
      UNVERIFIED: 180, INELIGIBLE: 1, SUSPENDED: 1, ELIGIBLE: 0, EXPIRING: 0,
    });
    expect(report.sections.drivers).toMatchObject({
      total: 158, linked: 141, unlinked: 17, ready: 0,
    });
    expect(report.sections.assignments).toMatchObject({
      total: 182, with_authorized_driver: 147,
    });
  });

  test('counts EXPIRING as a ready bucket, never as a plain failure', async () => {
    const report = await getDeploymentReadiness(
      fakeAggregatePool({ vehicle: { total: 10, status_eligible: 6, status_expiring: 2, status_unverified: 2 } }),
      { mode: 'OBSERVE' }
    );
    const ready = report.status_buckets.find((b) => b.key === 'ready');
    expect(ready.count).toBe(8); // 6 ELIGIBLE + 2 EXPIRING
    expect(report.sections.vehicles.ready).toBe(8);
  });

  test('produces the four UI status buckets with Thai labels', async () => {
    const report = await getDeploymentReadiness(fakeAggregatePool(), { mode: 'OBSERVE' });
    const keys = report.status_buckets.map((b) => b.key);
    expect(keys).toEqual(['ready', 'needs_data', 'at_risk', 'suspended']);
    const suspended = report.status_buckets.find((b) => b.key === 'suspended');
    expect(suspended).toMatchObject({ label_th: 'ถูกระงับ', count: 1 });
  });

  test('emits gaps with key, label_th, owner_role, count, and Thai next action', async () => {
    const report = await getDeploymentReadiness(fakeAggregatePool(), { mode: 'OBSERVE' });
    expect(report.gaps.length).toBeGreaterThan(0);
    for (const gap of report.gaps) {
      expect(gap).toEqual(expect.objectContaining({
        key: expect.any(String),
        label_th: expect.any(String),
        owner_role: expect.any(String),
        count: expect.any(Number),
        next_action_th: expect.any(String),
        hard_gate: expect.any(Boolean),
      }));
      expect(gap.count).toBeGreaterThan(0); // zero-count gaps are omitted
    }
    const unlinked = report.gaps.find((g) => g.key === 'driver_account_unlinked');
    expect(unlinked).toMatchObject({ owner_role: 'province', count: 17, hard_gate: true });
  });

  test('backup-driver coverage is a warning, not a hard gate', async () => {
    const report = await getDeploymentReadiness(fakeAggregatePool(), { mode: 'OBSERVE' });
    const backup = report.gaps.find((g) => g.key === 'vehicle_no_backup_driver');
    expect(backup.hard_gate).toBe(false);
    // It contributes to warning_count, not hard_gate_count.
    expect(report.warning_count).toBeGreaterThanOrEqual(backup.count);
  });

  test('a fully-ready province has no hard-gate gaps', async () => {
    const report = await getDeploymentReadiness(fakeAggregatePool({
      vehicle: {
        total: 3, status_eligible: 3, status_unverified: 0, status_ineligible: 0,
        status_suspended: 0, with_capacity: 3, with_valid_documents: 3,
      },
      inspection: { with_passed_inspection: 3 },
      driver: { total: 3, linked: 3, unlinked: 0, with_verified_qualification: 3 },
      assignment: { total: 3, with_authorized_driver: 3, with_backup_driver: 3 },
    }), { mode: 'ENFORCE' });
    expect(report.hard_gate_count).toBe(0);
    expect(report.gaps.filter((g) => g.hard_gate)).toHaveLength(0);
  });

  test('the report contains NO PII fields (aggregate counts only)', async () => {
    const report = await getDeploymentReadiness(fakeAggregatePool(), { mode: 'OBSERVE' });
    const serialized = JSON.stringify(report);
    // No personal-data field names anywhere in the payload.
    expect(serialized).not.toMatch(
      /first_name|last_name|cid|cid_hash|phone|license_no|owner_name|plate_no|student_name|display_name/i
    );
    // Every leaf in sections.* is a number, an object, or a status string —
    // never a free-text personal value.
    for (const sec of Object.values(report.sections)) {
      for (const [k, val] of Object.entries(sec)) {
        if (k === 'by_status') continue;
        expect(typeof val).toBe('number');
      }
    }
  });

  test('runs all four aggregate queries and never selects a PII column', async () => {
    const pool = fakeAggregatePool();
    await getDeploymentReadiness(pool, { mode: 'OBSERVE' });
    expect(pool.query).toHaveBeenCalledTimes(4);
    for (const sql of pool.calls) {
      expect(sql).not.toMatch(/first_name|last_name|cid_hash|\bphone\b|license_no|student_name/i);
    }
  });
});
