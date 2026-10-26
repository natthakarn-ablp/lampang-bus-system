'use strict';

require('./loadTestEnv');
const fs = require('fs');
const path = require('path');
const { verifyDriverPermissions } = require('../scripts/verify-driver-permissions');

describe('driver permission workflow contract', () => {
  let report;
  beforeAll(() => { report = verifyDriverPermissions(); });

  test('all required and denied route checks pass', () => {
    expect(report.driver_route_count).toBeGreaterThan(50);
    expect(report.findings).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.counts).toMatchObject({ VIEW: 20, EDIT: 27, EMERGENCY: 1, DENY: 8, CONDITIONAL: 12 });
  });

  test('driver has no export, administration or transport-approval route', () => {
    for (const id of ['deny:driver-export', 'deny:transport-approval', 'deny:/api/admin', 'deny:/api/reports', 'deny:/api/transport']) {
      expect(report.checks).toContainEqual(expect.objectContaining({ id, passed: true }));
    }
  });

  test('frontend driver menu contains work pages and excludes oversight pages', () => {
    const sidebar = fs.readFileSync(path.join(__dirname, '../../frontend/src/components/Sidebar.jsx'), 'utf8');
    const block = sidebar.slice(sidebar.indexOf('const DRIVER_NAV'), sidebar.indexOf('const SCHOOL_NAV'));
    for (const route of ['/driver', '/driver/pickup-map', '/driver/vehicle-registration', '/driver/applications', '/driver/emergency', '/driver/profile']) {
      expect(block).toContain(route);
    }
    for (const route of ['/reports', '/admin', '/transport', '/school/students']) expect(block).not.toContain(route);
  });

  test('legacy driver consent URL follows the Vehicle QR feature flag', () => {
    const app = fs.readFileSync(path.join(__dirname, '../../frontend/src/App.jsx'), 'utf8');
    expect(app).toMatch(/function DriverConsentRoute\(\)[\s\S]*features\?\.vehicleQr/);
    expect(app).toMatch(/features\?\.vehicleQr\) return <Navigate to="\/my-policy" replace \/>/);
    expect(app).toMatch(/path="\/driver\/consent"[\s\S]*<DriverConsentRoute \/>/);
  });
});
