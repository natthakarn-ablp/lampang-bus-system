'use strict';

// Audit time-02: leave_date must be a real calendar date. Date.parse rolls
// 2027-02-31 over to 3 Mar, so the old check let it through to the DB lookup.
const mockGetConnection = jest.fn();
jest.mock('../src/config/database', () => ({ pool: { getConnection: (...a) => mockGetConnection(...a) } }));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));

const { createLeave } = require('../src/services/leave.service');

const base = { studentId: 1, vehicleId: 'V-1', session: 'morning', reason: 'x', userId: 1, userRole: 'driver' };

describe('createLeave leave_date calendar validation', () => {
  beforeEach(() => mockGetConnection.mockReset());

  test.each(['2027-02-31', '2027-04-31', '2027-13-01', '2027-00-10'])(
    'rejects impossible date %s with 400 before touching the DB', async (d) => {
      await expect(createLeave({ ...base, leaveDate: d })).rejects.toMatchObject({ statusCode: 400 });
      expect(mockGetConnection).not.toHaveBeenCalled();
    });
});
