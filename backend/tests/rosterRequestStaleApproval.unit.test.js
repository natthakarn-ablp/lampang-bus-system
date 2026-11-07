'use strict';

// DRV-ROSTER-05: approving a stale roster request must not move/unassign a
// student who has since been reassigned to a different vehicle.

const mockConn = { query: jest.fn(), beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn() };
jest.mock('../src/config/database', () => ({
  pool: { getConnection: jest.fn(async () => mockConn), query: jest.fn() },
}));
jest.mock('../src/utils/audit', () => ({ logAudit: jest.fn() }));

const { reviewRequest } = require('../src/services/rosterRequest.service');

function setup(requestType, studentVehicleId) {
  mockConn.query.mockReset();
  mockConn.query.mockImplementation(async (sql) => {
    if (/FROM roster_change_requests/.test(sql)) {
      return [[{ id: 1, school_id: 5, vehicle_id: 10, student_id: 77, request_type: requestType, status: 'pending' }]];
    }
    if (/^\s*UPDATE roster_change_requests/.test(sql)) return [{ affectedRows: 1 }];
    if (/FROM students/.test(sql)) return [[{ id: 77, vehicle_id: studentVehicleId }]];
    return [{ affectedRows: 1 }];
  });
}
const approve = () => reviewRequest({ requestId: 1, schoolId: 5, status: 'approved', userId: 2 });
const studentUpdates = () => mockConn.query.mock.calls.filter(([s]) => /UPDATE students/.test(s));

describe('reviewRequest stale vehicle guard', () => {
  test('remove: student moved to another vehicle -> 409, no unassign', async () => {
    setup('remove', 11);
    await expect(approve()).rejects.toMatchObject({ statusCode: 409 });
    expect(studentUpdates()).toHaveLength(0);
  });

  test('remove: student still on the vehicle -> unassigned', async () => {
    setup('remove', 10);
    await approve();
    expect(studentUpdates()).toHaveLength(1);
  });

  test('add: student now on another vehicle -> 409, not pulled', async () => {
    setup('add', 11);
    await expect(approve()).rejects.toMatchObject({ statusCode: 409 });
    expect(studentUpdates()).toHaveLength(0);
  });

  test('add: student unassigned -> assigned', async () => {
    setup('add', null);
    await approve();
    expect(studentUpdates()).toHaveLength(1);
  });
});
