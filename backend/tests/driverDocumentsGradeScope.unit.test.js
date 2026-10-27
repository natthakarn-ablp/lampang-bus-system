'use strict';

require('./loadTestEnv');
jest.mock('../src/services/line.service', () => ({
  sendTextMessage: jest.fn().mockResolvedValue({ sent: true }),
}));

const docSvc = require('../src/services/driverDocuments.service');

describe('resolveDocumentForViewer grade scope', () => {
  test.each(['vehicle', 'driver'])(
    'denies grade-scoped school accounts from %s documents before querying',
    async (docType) => {
      const pool = { query: jest.fn().mockResolvedValue([[{ id: 1 }]]) };

      await expect(docSvc.resolveDocumentForViewer(pool, {
        docType,
        id: 1,
        viewer: { role: 'school', userId: 9, schoolId: 'SCH1', gradeScope: 'G4' },
      })).rejects.toMatchObject({
        statusCode: 403,
        errors: [{ code: 'FULL_SCHOOL_SCOPE_REQUIRED' }],
      });
      expect(pool.query).not.toHaveBeenCalled();
    },
  );

  test('keeps access for a full-school account', async () => {
    const row = {
      id: 1,
      vehicle_id: 'V-1',
      storage_key: '5-1.pdf',
      mime_type: 'application/pdf',
      original_name: 'reg.pdf',
      doc_type: 'VEHICLE_REGISTRATION',
    };
    const pool = {
      query: jest.fn(async (sql) => (/inspection_application_schools aps/.test(sql) ? [[row]] : [[]])),
    };

    const result = await docSvc.resolveDocumentForViewer(pool, {
      docType: 'vehicle',
      id: 1,
      viewer: { role: 'school', userId: 9, schoolId: 'SCH1', gradeScope: null },
    });

    expect(result.absPath).toContain('5-1.pdf');
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
