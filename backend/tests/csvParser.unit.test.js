'use strict';

const { parseCsvRecords } = require('../src/utils/csv');

describe('parseCsvRecords', () => {
  test('keeps commas inside quoted fields instead of shifting columns', () => {
    const rows = parseCsvRecords('school_code,school_name,username,initial_password\n5201,"โรงเรียนบ้านใหม่, สาขา 2",u1,"p,1"\n');
    expect(rows).toEqual([
      ['school_code', 'school_name', 'username', 'initial_password'],
      ['5201', 'โรงเรียนบ้านใหม่, สาขา 2', 'u1', 'p,1'],
    ]);
  });
});
