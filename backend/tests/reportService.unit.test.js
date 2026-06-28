'use strict';

// Unit test for the report service. getPolicyReport's RBAC guard is enforced
// BEFORE any DB access, so it is testable DB-free (the data path needs a real DB
// and is covered by the live smoke).

require('./loadTestEnv');
const reportSvc = require('../src/services/report.service');

describe('getPolicyReport RBAC guard', () => {
  test('rejects non-province/admin roles with 403 before touching the DB', async () => {
    for (const role of ['school', 'affiliation', 'driver', 'transport']) {
      await expect(reportSvc.getPolicyReport({ role }, {}))
        .rejects.toMatchObject({ statusCode: 403, errors: [{ code: 'FORBIDDEN' }] });
    }
  });
});
