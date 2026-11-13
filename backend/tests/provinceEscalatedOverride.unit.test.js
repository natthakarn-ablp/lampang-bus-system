'use strict';

/**
 * Province decides on the affiliation's behalf once a request has waited
 * ESCALATE (7) days (owner decision 2026-11-13). Guards:
 *   - younger than 7 days → 409 NOT_ESCALATED_YET, nothing decided
 *   - not pending for an affiliation → 409 NOT_PENDING_FOR_AFFILIATION
 *   - reject needs a reason → 400
 *   - only province/admin reach the routes
 * The decision calls the affiliation's guard + service with the item's own
 * affiliation and writes an override audit row with by_role.
 */

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 9, role: req.headers['x-test-role'] || 'province' };
    next();
  },
}));
jest.mock('../src/config/database', () => ({ pool: { query: jest.fn(), getConnection: jest.fn() } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/studentTransfer.service', () => ({
  assertAffiliationCanDecide: jest.fn(),
  approveAndApply: jest.fn(),
  reject: jest.fn(),
  approveOutcomeMessage: jest.requireActual('../src/services/studentTransfer.service').approveOutcomeMessage,
}));
jest.mock('../src/services/vehicleRequest.service', () => ({
  getDetailForAffiliation: jest.fn(),
  approveVehicleRequest: jest.fn(),
  rejectVehicleRequest: jest.fn(),
  approveOutcomeMessage: jest.requireActual('../src/services/vehicleRequest.service').approveOutcomeMessage,
}));

const express = require('express');
const request = require('supertest');
const { pool } = require('../src/config/database');
const { logAudit } = require('../src/utils/audit');
const transfer = require('../src/services/studentTransfer.service');
const vr = require('../src/services/vehicleRequest.service');
const errorHandler = require('../src/middleware/errorHandler');

const DAY = 86400;

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/province', require('../src/routes/province.routes'));
  a.use(errorHandler);
  return a;
}

// The queue row the pendingQueue SQL would return for the item.
function queueRow(row) {
  pool.query.mockImplementation(async (sql, params) => {
    if (/FROM \(/.test(sql) && /x\.item_id = \?/.test(sql)) {
      return [row ? [{ item_id: params[0], school_id: '10', school_name: 'โรงเรียน ก', affiliation_id: 3, ...row }] : []];
    }
    return [[]];
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.PENDING_ESCALATE_DAYS;
  delete process.env.PENDING_OVERDUE_DAYS;
  transfer.assertAffiliationCanDecide.mockResolvedValue({ direction: 'INTERNAL' });
  transfer.approveAndApply.mockResolvedValue({ status: 'APPLIED' });
  transfer.reject.mockResolvedValue({ id: 5, status: 'REJECTED' });
  vr.getDetailForAffiliation.mockResolvedValue({ can_approve: true });
  vr.approveVehicleRequest.mockResolvedValue({ status: 'APPLIED', informational: true });
  vr.rejectVehicleRequest.mockResolvedValue({ id: 5, status: 'REJECTED' });
});

describe('age guard', () => {
  test('a transfer that has waited 6 days is refused with 409 and nothing is decided', async () => {
    queueRow({ age_s: 6 * DAY + 3600 });
    const res = await request(app()).post('/api/province/escalated/transfer-requests/5/approve').send({});
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/7 วัน/);
    expect(res.body.errors[0].code).toBe('NOT_ESCALATED_YET');
    expect(transfer.approveAndApply).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  test('a vehicle request younger than 7 days cannot be rejected either', async () => {
    queueRow({ age_s: 2 * DAY });
    const res = await request(app()).post('/api/province/escalated/vehicle-requests/5/reject').send({ reason: 'ข้อมูลไม่ครบ' });
    expect(res.status).toBe(409);
    expect(vr.rejectVehicleRequest).not.toHaveBeenCalled();
  });

  test('an item no longer pending for an affiliation → 409', async () => {
    queueRow(null);
    const res = await request(app()).post('/api/province/escalated/transfer-requests/5/approve').send({});
    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('NOT_PENDING_FOR_AFFILIATION');
  });

  test('an escalated item with no affiliation is left to the admin', async () => {
    queueRow({ age_s: 10 * DAY, affiliation_id: null });
    const res = await request(app()).post('/api/province/escalated/vehicle-requests/5/approve').send({});
    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('NO_AFFILIATION');
  });
});

describe('decisions after 7 days', () => {
  test('approve transfer: affiliation guard with the item\'s affiliation, same service, override audit', async () => {
    queueRow({ age_s: 8 * DAY });
    const res = await request(app()).post('/api/province/escalated/transfer-requests/5/approve').send({ reason: 'สังกัดไม่ตอบ' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('อนุมัติและดำเนินการโอนย้ายสำเร็จ');
    expect(transfer.assertAffiliationCanDecide).toHaveBeenCalledWith(pool, { requestId: 5, affiliationId: '3' });
    expect(transfer.approveAndApply).toHaveBeenCalledWith(pool, { requestId: 5, adminUserId: 9, adminNote: 'สังกัดไม่ตอบ' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9, action: 'APPROVE', entityType: 'student_transfer_request', entityId: '5',
      newValue: expect.objectContaining({ override: true, by_role: 'province', on_behalf_of: 'affiliation', affiliation_id: '3', waited_days: 8, result: 'APPLIED' }),
    }));
  });

  test('reject vehicle request needs a reason', async () => {
    queueRow({ age_s: 9 * DAY });
    const res = await request(app()).post('/api/province/escalated/vehicle-requests/5/reject').send({ reason: '' });
    expect(res.status).toBe(400);
    expect(vr.rejectVehicleRequest).not.toHaveBeenCalled();
  });

  test('reject vehicle request with reason runs the affiliation reject and audits', async () => {
    queueRow({ age_s: 9 * DAY });
    const res = await request(app()).post('/api/province/escalated/vehicle-requests/5/reject').send({ reason: 'ทะเบียนไม่ตรง' });
    expect(res.status).toBe(200);
    expect(vr.getDetailForAffiliation).toHaveBeenCalledWith(pool, { requestId: 5, affiliationId: '3' });
    expect(vr.rejectVehicleRequest).toHaveBeenCalledWith(pool, { requestId: 5, adminUserId: 9, adminNote: 'ทะเบียนไม่ตรง' });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE', entityType: 'vehicle_request',
      newValue: expect.objectContaining({ override: true, by_role: 'province', result: 'REJECTED', reason: 'ทะเบียนไม่ตรง' }),
    }));
  });

  test('a cross-affiliation transfer is still refused by the affiliation guard', async () => {
    queueRow({ age_s: 8 * DAY });
    const e = new Error('ข้ามสังกัด'); e.statusCode = 403;
    transfer.assertAffiliationCanDecide.mockRejectedValueOnce(e);
    const res = await request(app()).post('/api/province/escalated/transfer-requests/5/approve').send({});
    expect(res.status).toBe(403);
    expect(transfer.approveAndApply).not.toHaveBeenCalled();
  });

  test('the threshold follows PENDING_ESCALATE_DAYS', async () => {
    process.env.PENDING_ESCALATE_DAYS = '10';
    queueRow({ age_s: 8 * DAY });
    const res = await request(app()).post('/api/province/escalated/transfer-requests/5/approve').send({});
    expect(res.status).toBe(409);
  });
});

describe('role guard', () => {
  test.each(['affiliation', 'school', 'transport', 'driver'])('%s cannot call the province override', async (role) => {
    queueRow({ age_s: 30 * DAY });
    const res = await request(app()).post('/api/province/escalated/transfer-requests/5/approve').set('x-test-role', role).send({});
    expect(res.status).toBe(403);
    expect(transfer.approveAndApply).not.toHaveBeenCalled();
  });
});
