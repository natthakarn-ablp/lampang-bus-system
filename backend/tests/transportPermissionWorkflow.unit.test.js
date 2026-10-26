'use strict';

require('./loadTestEnv');
const fs = require('fs');
const path = require('path');
const { verifyTransportPermissions } = require('../scripts/verify-transport-permissions');

describe('transport permission workflow contract', () => {
  let report;
  beforeAll(() => { report = verifyTransportPermissions(); });

  test('all required, denied and conditional route checks pass', () => {
    expect(report.transport_route_count).toBeGreaterThan(30);
    expect(report.findings).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.counts).toMatchObject({ VIEW: 16, EDIT: 7, APPROVE: 3, EXPORT: 1, DENY: 4, CONDITIONAL: 3 });
  });

  test('transport remains excluded from student reports, school writes and driver check-in', () => {
    for (const prefix of ['/api/reports', '/api/school', '/api/driver', '/api/admin/users']) {
      expect(report.checks).toContainEqual(expect.objectContaining({ id: `deny:${prefix}`, passed: true }));
    }
  });

  test('frontend menu exposes the four transport work areas and no general reports', () => {
    const sidebar = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/Sidebar.jsx'), 'utf8');
    const layout = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/transport/TransportLayout.jsx'), 'utf8');
    for (const route of ['/transport', '/transport/verification', '/transport/inspections', '/transport/pickup-map']) {
      expect(sidebar).toContain(route);
      expect(layout).toContain(route);
    }
    const transportBlock = sidebar.slice(sidebar.indexOf('const TRANSPORT_NAV'), sidebar.indexOf('const ADMIN_NAV'));
    expect(transportBlock).not.toContain('/reports');
    expect(transportBlock).not.toContain('/students');
    expect(transportBlock).not.toContain('/checkin');
  });
});
