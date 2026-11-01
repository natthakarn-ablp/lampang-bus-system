'use strict';

require('./loadTestEnv');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runPreview, applyBatch, getReport } = require('../src/services/studentImportPreview.service');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grade-entry-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function csv(grades) {
  const file = path.join(dir, `students-${grades.join('-')}.csv`);
  const lines = ['รหัสนักเรียน,คำนำหน้า,ชื่อ,นามสกุล,ชั้น,ห้อง,ทะเบียนรถ,ชื่อผู้ปกครอง,เบอร์โทรผู้ปกครอง'];
  grades.forEach((grade, i) => lines.push(`${100 + i},เด็กชาย,ทดสอบ,ตัวอย่าง,${grade},1,,,`));
  fs.writeFileSync(file, '\uFEFF' + lines.join('\n') + '\n');
  return file;
}

const args = { schoolId: 'SCH1', importedBy: 7, originalName: 'students.csv', gradeScope: 'ป.4' };

test.each([
  [['ป.5'], 'different grade'],
  [['ป.4', 'ป.4'], 'bulk file'],
])('teacher preview rejects %s before database access (%s)', async (grades) => {
  const pool = { query: jest.fn(), getConnection: jest.fn() };
  await expect(runPreview(pool, { ...args, filePath: csv(grades) })).rejects.toMatchObject({ statusCode: 403 });
  expect(pool.query).not.toHaveBeenCalled();
  expect(pool.getConnection).not.toHaveBeenCalled();
});

test('teacher preview rejects an existing code in another grade without exposing its details', async () => {
  const pool = { query: jest.fn().mockResolvedValue([[{ grade: 'ประถมศึกษาปีที่ 5' }]]), getConnection: jest.fn() };
  await expect(runPreview(pool, { ...args, filePath: csv(['ป.4']) })).rejects.toMatchObject({ statusCode: 409 });
  expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('SELECT grade FROM students'), ['SCH1', '100']);
  expect(pool.getConnection).not.toHaveBeenCalled();
});

function scopedPool({ importedBy = 7, grade = 'ป.4', totalRows = 1 } = {}) {
  return { query: jest.fn(async (sql) => {
    if (sql.includes('SELECT school_id, imported_by, total_rows')) return [[{ school_id: 'SCH1', imported_by: importedBy, total_rows: totalRows }]];
    if (sql.includes('SELECT normalized_json')) return [[{ normalized_json: JSON.stringify({ grade }) }]];
    if (sql.includes('SELECT id, school_id, filename')) return [[{ id: 1, school_id: 'SCH1', total_rows: 1 }]];
    if (sql.includes('FROM import_batch_rows WHERE batch_id = ? ORDER BY row_no')) return [[]];
    throw new Error(`Unexpected query: ${sql}`);
  }) };
}

test.each([
  [{ importedBy: 8 }, 'another teacher'],
  [{ grade: 'ป.5' }, 'another grade'],
  [{ totalRows: 2 }, 'multi-row batch'],
])('teacher cannot apply %s batch (%s)', async (setup) => {
  const pool = scopedPool(setup);
  await expect(applyBatch(pool, { batchId: 1, schoolId: 'SCH1', userId: 7, gradeScope: 'ป.4' })).rejects.toMatchObject({ statusCode: 403 });
  expect(pool.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE import_batches'), expect.anything());
});

test('teacher cannot use guardian-update mode, even on an own batch', async () => {
  const pool = scopedPool();
  await expect(applyBatch(pool, { batchId: 1, schoolId: 'SCH1', userId: 7, gradeScope: 'ป.4', mode: 'update_guardian_confirmed' })).rejects.toMatchObject({ statusCode: 403 });
  expect(pool.query).not.toHaveBeenCalled();
});

test('teacher reads only own one-row report', async () => {
  const own = scopedPool();
  const result = await getReport(own, { batchId: 1, schoolId: 'SCH1', userId: 7, gradeScope: 'ป.4' });
  expect(result.rows).toEqual([]);
  const other = scopedPool({ importedBy: 8 });
  await expect(getReport(other, { batchId: 1, schoolId: 'SCH1', userId: 7, gradeScope: 'ป.4' })).rejects.toMatchObject({ statusCode: 403 });
});
