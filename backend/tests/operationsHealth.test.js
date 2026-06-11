'use strict';

/**
 * operationsHealth.test.js  (Phase 10.13B-9)
 * Severity ranking + no-PII for the shared monitor, and safe exit codes for
 * the readiness scripts when config is missing.
 */
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const path = require('path');

jest.mock('fs');
const fs = require('fs');

const GZ = Buffer.from('backup-bytes');
const SHA = crypto.createHash('sha256').update(GZ).digest('hex');
beforeEach(() => {
  fs.existsSync.mockReturnValue(true);
  fs.readdirSync.mockImplementation((p) => (String(p).includes('migrations') ? [] : ['lampang_bus_x.sql.gz']));
  fs.statSync.mockReturnValue({ mtimeMs: Date.now(), size: 1000 });
  fs.readFileSync.mockImplementation((p) => (String(p).endsWith('.sha256') ? `${SHA}  lampang_bus_x.sql.gz` : GZ));
  fs.statfsSync = jest.fn().mockReturnValue({ blocks: 100, bsize: 1, bavail: 60 }); // 40% used → OK
});

const { computeOperationsHealth } = require('../src/services/operationsHealth.service');

// Mock pool: every count query returns 0 unless overridden by SQL fragment.
function makePool(over = {}) {
  return {
    query: async (sql) => {
      if (/FROM schema_migrations/.test(sql)) return [[]];
      let n = 0;
      if (/GROUP BY school_id, student_code/.test(sql)) n = over.dup || 0;
      else if (/school_id IS NULL OR student_code IS NULL/.test(sql)) n = over.missing || 0;
      else if (/JOIN vehicles v ON v\.id=d\.vehicle_id WHERE d\.is_active=1 AND v\.is_deleted=1/.test(sql)) n = over.orphan || 0;
      else if (/driver_vehicle_assignments WHERE is_active=1 GROUP BY vehicle_id/.test(sql)) n = over.dupAsg || 0;
      else if (/active_canonical_plate IS NOT NULL GROUP BY active_canonical_plate/.test(sql)) n = over.canon || 0;
      else if (/vehicles v WHERE v\.is_deleted=0 AND NOT EXISTS/.test(sql)) n = over.vehNoDriver || 0;
      return [[{ n }]];
    },
  };
}

describe('computeOperationsHealth (10.13B-9)', () => {
  test('all-clear → OK with a checks array', async () => {
    const r = await computeOperationsHealth(makePool());
    expect(r.status).toBe('OK');
    expect(Array.isArray(r.checks)).toBe(true);
    expect(r.checks.length).toBeGreaterThan(10);
  });
  test('duplicate same-school code → CRITICAL (outranks everything)', async () => {
    const r = await computeOperationsHealth(makePool({ dup: 3 }));
    expect(r.status).toBe('CRITICAL');
    expect(r.checks.find((c) => c.key === 'dup_student_code').severity).toBe('CRITICAL');
  });
  test('orphan active assignment → CRITICAL', async () => {
    expect((await computeOperationsHealth(makePool({ orphan: 1 }))).status).toBe('CRITICAL');
  });
  test('active canonical vehicle duplicate → CRITICAL', async () => {
    expect((await computeOperationsHealth(makePool({ canon: 2 }))).status).toBe('CRITICAL');
  });
  test('vehicle without driver (no critical) → WARN', async () => {
    const r = await computeOperationsHealth(makePool({ vehNoDriver: 1 }));
    expect(r.status).toBe('WARN');
  });
  test('WARN never outranks CRITICAL', async () => {
    expect((await computeOperationsHealth(makePool({ vehNoDriver: 5, dup: 1 }))).status).toBe('CRITICAL');
  });
  test('output contains no phone numbers (no PII)', async () => {
    const txt = JSON.stringify(await computeOperationsHealth(makePool({ vehNoDriver: 1 })));
    expect(/\b0[689]\d{8}\b/.test(txt)).toBe(false);
  });
});

describe('readiness scripts exit safely when config is missing (10.13B-9)', () => {
  const ROOT = path.join(__dirname, '../..');
  const runExit = (rel) => {
    try { execFileSync('bash', [path.join(ROOT, rel)], { stdio: 'pipe' }); return 0; }
    catch (e) { return e.status; }
  };
  test('restore-test-readiness.sh → exit 1 (not ready) when no test DB config', () => {
    expect(runExit('scripts/restore-test-readiness.sh')).toBe(1);
  });
  test('check-offhost-backup-config.sh → exit 1 (config missing)', () => {
    expect(runExit('scripts/check-offhost-backup-config.sh')).toBe(1);
  });
});
