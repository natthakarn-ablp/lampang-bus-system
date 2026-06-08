'use strict';

/**
 * driverLeaveScope.test.js  (Phase 10.12E — closes H4)
 *
 * ISOLATED — DB pool, audit, and the driver's vehicle/leave services are mocked,
 * so these run without globalSetup and never touch the production DB. They prove
 * a driver can only cancel a leave belonging to their own active vehicle.
 */

jest.mock('../src/config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));
jest.mock('../src/services/leave.service');   // auto-mock → spies (route tests)
jest.mock('../src/services/checkin.service'); // auto-mock → spies (route tests)
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 5, username: 'V-MINE', role: 'driver' }; next(); },
}));

const express = require('express');
const request = require('supertest');

const { pool } = require('../src/config/database');
const { logAudit } = require('../src/utils/audit');

// Real cancelLeave implementation (bypasses the auto-mock) — uses the mocked pool.
const realLeaveSvc = jest.requireActual('../src/services/leave.service');

// Mocked services used by the driver router:
const leaveSvc = require('../src/services/leave.service');
const checkinSvc = require('../src/services/checkin.service');
const driverRoutes = require('../src/routes/driver.routes');

// ─── 1. Service-level scoping ────────────────────────────────────────────────
describe('cancelLeave service is vehicle-scoped (H4)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('own-vehicle cancel: UPDATE is scoped by vehicle_id and audits', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 1 }]);
    const res = await realLeaveSvc.cancelLeave(10, 5, 'V-MINE');
    expect(res).toEqual({ id: 10, cancelled: true });
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/vehicle_id = \?/);
    expect(params).toEqual([5, 10, 'V-MINE']); // userId, leaveId, vehicleId
    expect(logAudit).toHaveBeenCalledTimes(1);
  });

  test('cross-vehicle / missing / already-cancelled (affectedRows 0) → 404, no audit', async () => {
    pool.query.mockResolvedValue([{ affectedRows: 0 }]);
    await expect(realLeaveSvc.cancelLeave(10, 5, 'V-OTHER')).rejects.toMatchObject({ statusCode: 404 });
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('404 error message leaks no student PII', async () => {
    expect.assertions(2);
    pool.query.mockResolvedValue([{ affectedRows: 0 }]);
    try {
      await realLeaveSvc.cancelLeave(10, 5, 'V-OTHER');
    } catch (e) {
      expect(e.message).not.toMatch(/\d{13}/);                 // no national id
      expect(e.message).not.toMatch(/first_name|phone|cid/i);  // no PII field names
    }
  });
});

// ─── 2. Route-level wiring ───────────────────────────────────────────────────
describe('DELETE /api/driver/leave/:id passes the driver vehicle scope (H4)', () => {
  let app;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/driver', driverRoutes);
    // eslint-disable-next-line no-unused-vars
    app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, message: err.message }));
  });
  beforeEach(() => jest.clearAllMocks());

  test('passes (leaveId, userId, active vehicle_id) into cancelLeave → 200', async () => {
    checkinSvc.getDriverVehicle.mockResolvedValue({ vehicle_id: 'V-MINE', plate_no: 'P' });
    leaveSvc.cancelLeave.mockResolvedValue({ id: 10, cancelled: true });
    const res = await request(app).delete('/api/driver/leave/10');
    expect(res.status).toBe(200);
    expect(leaveSvc.cancelLeave).toHaveBeenCalledWith(10, 5, 'V-MINE');
  });

  test('no active vehicle assignment → 400, cancelLeave NOT called', async () => {
    const e = new Error('No active driver assignment found'); e.statusCode = 400;
    checkinSvc.getDriverVehicle.mockRejectedValue(e);
    const res = await request(app).delete('/api/driver/leave/10');
    expect(res.status).toBe(400);
    expect(leaveSvc.cancelLeave).not.toHaveBeenCalled();
  });

  test('cross-vehicle attempt surfaces 404 from the scoped service (no PII)', async () => {
    checkinSvc.getDriverVehicle.mockResolvedValue({ vehicle_id: 'V-MINE', plate_no: 'P' });
    const e = new Error('ไม่พบรายการลาหรือยกเลิกไปแล้ว'); e.statusCode = 404;
    leaveSvc.cancelLeave.mockRejectedValue(e);
    const res = await request(app).delete('/api/driver/leave/77');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/\d{13}|first_name|phone/i);
  });
});
