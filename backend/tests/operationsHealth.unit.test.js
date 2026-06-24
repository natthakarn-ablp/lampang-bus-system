'use strict';

jest.mock('fs');
jest.mock('../src/services/deploymentReadiness.service', () => ({
  getDeploymentReadiness: jest.fn(async () => ({ policy_mode: 'OBSERVE', hard_gate_count: 0 })),
}));

const crypto = require('crypto');
const fs = require('fs');
const { getDeploymentReadiness } = require('../src/services/deploymentReadiness.service');
const { computeOperationsHealth } = require('../src/services/operationsHealth.service');

const GZ = Buffer.from('backup-bytes');
const SHA = crypto.createHash('sha256').update(GZ).digest('hex');

beforeEach(() => {
  jest.clearAllMocks();
  fs.existsSync.mockReturnValue(true);
  fs.readdirSync.mockImplementation((p) => (String(p).includes('migrations') ? [] : ['lampang_bus_x.sql.gz']));
  fs.statSync.mockReturnValue({ mtimeMs: Date.now(), size: 1000 });
  fs.readFileSync.mockImplementation((p) => (String(p).endsWith('.sha256') ? `${SHA}  lampang_bus_x.sql.gz` : GZ));
  fs.statfsSync = jest.fn().mockReturnValue({ blocks: 100, bsize: 1, bavail: 60 });
  getDeploymentReadiness.mockResolvedValue({ policy_mode: 'OBSERVE', hard_gate_count: 0 });
});

function makePool(over = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql) => {
      calls.push(sql);
      if (/FROM schema_migrations/.test(sql)) return [[]];
      if (/driver_vehicle_assignments\s+WHERE is_active=1\s+GROUP BY driver_id, vehicle_id/i.test(sql)) {
        return [[{ n: over.duplicateDriverVehiclePairs || 0 }]];
      }
      if (/driver_vehicle_assignments\s+WHERE is_active=1\s+GROUP BY vehicle_id/i.test(sql)) {
        return [[{ n: over.multipleDriversSameVehicle || 0 }]];
      }
      if (/vehicles v WHERE v\.is_deleted=0 AND NOT EXISTS/i.test(sql)) return [[{ n: over.vehNoDriver || 0 }]];
      return [[{ n: 0 }]];
    },
  };
}

describe('computeOperationsHealth readiness and driver-assignment checks', () => {
  test('does not treat multiple authorized drivers on one vehicle as a duplicate assignment', async () => {
    const report = await computeOperationsHealth(makePool({ multipleDriversSameVehicle: 2 }));
    expect(report.checks.find((c) => c.key === 'dup_active_assignment')).toMatchObject({
      severity: 'OK',
      value: 0,
    });
  });

  test('treats duplicate active driver-vehicle pairs as critical', async () => {
    const report = await computeOperationsHealth(makePool({ duplicateDriverVehiclePairs: 1 }));
    expect(report.checks.find((c) => c.key === 'dup_active_assignment')).toMatchObject({
      severity: 'CRITICAL',
      value: 1,
    });
  });

  test('adds deployment readiness as a warning in OBSERVE when hard gates remain', async () => {
    getDeploymentReadiness.mockResolvedValueOnce({ policy_mode: 'OBSERVE', hard_gate_count: 12 });
    const report = await computeOperationsHealth(makePool());
    expect(report.status).toBe('WARN');
    expect(report.checks.find((c) => c.key === 'deployment_readiness')).toMatchObject({
      severity: 'WARN',
      value: 12,
      detail: 'mode=OBSERVE',
    });
  });

  test('adds deployment readiness as critical in ENFORCE when hard gates remain', async () => {
    getDeploymentReadiness.mockResolvedValueOnce({ policy_mode: 'ENFORCE', hard_gate_count: 3 });
    const report = await computeOperationsHealth(makePool());
    expect(report.status).toBe('CRITICAL');
    expect(report.checks.find((c) => c.key === 'deployment_readiness')).toMatchObject({
      severity: 'CRITICAL',
      value: 3,
      detail: 'mode=ENFORCE',
    });
  });
});
