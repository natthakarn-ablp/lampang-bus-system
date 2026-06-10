'use strict';

/**
 * securityHardening.test.js  (Phase 10.13A-27)
 * Tenant-boundary + ops-safety unit tests.
 */
const { getReport, applyBatch } = require('../src/services/studentImportPreview.service');
const { insideImportDir, IMPORT_DIR } = require('../scripts/cleanup-expired-imports');
const { maskPhone } = require('../src/utils/studentImportClassifier');

function poolWithBatch(schoolId) {
  return {
    query: async (sql) => {
      if (/FROM import_batches WHERE id/.test(sql)) return [[{ id: 1, school_id: schoolId, filename: 'f.csv', status: 'PREVIEWED', total_rows: 3 }]];
      if (/FROM import_batch_rows WHERE batch_id/.test(sql)) return [[]];
      return [[]];
    },
  };
}

describe('import batch tenant isolation (10.13A-27)', () => {
  test('getReport: school cannot read another school\'s batch → 403', async () => {
    await expect(getReport(poolWithBatch('52020082'), { batchId: 1, schoolId: '52020147' })).rejects.toMatchObject({ statusCode: 403 });
  });
  test('getReport: same school is allowed', async () => {
    const out = await getReport(poolWithBatch('52020147'), { batchId: 1, schoolId: '52020147' });
    expect(out.batch.id).toBe(1);
  });
  test('applyBatch: school cannot apply another school\'s batch → 403', async () => {
    await expect(applyBatch(poolWithBatch('52020082'), { batchId: 1, schoolId: '52020147', userId: 1 })).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('cleanup-expired-imports path-traversal guard (10.13A-27)', () => {
  test('accepts a file inside the import dir', () => {
    expect(insideImportDir(IMPORT_DIR + '/import-1-2.csv')).toBe(true);
  });
  test('rejects traversal / outside paths', () => {
    expect(insideImportDir(IMPORT_DIR + '/../../../etc/passwd')).toBe(false);
    expect(insideImportDir('/etc/passwd')).toBe(false);
    expect(insideImportDir('')).toBe(false);
    expect(insideImportDir(null)).toBe(false);
  });
  test('rejects a sibling dir that shares the prefix string', () => {
    expect(insideImportDir(IMPORT_DIR + '-evil/x.csv')).toBe(false);
  });
});

describe('PII masking (10.13A-27)', () => {
  test('maskPhone hides the middle digits', () => {
    expect(maskPhone('0812345678')).toBe('081****78');
    expect(maskPhone('')).toBe('');
  });
});
