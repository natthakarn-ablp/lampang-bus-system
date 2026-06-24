'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  collectMigrationFiles,
  hashFile,
  validateStaticBaseline,
  validateTrackedMigrations,
} = require('../scripts/validate-migration-baseline');

function makeMigrationDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lampang-migrations-'));
  fs.writeFileSync(path.join(dir, '001_initial_schema.sql'), 'CREATE TABLE a (id INT);\n');
  fs.writeFileSync(path.join(dir, '038_shared_vehicle_verification.sql'), 'CREATE TABLE b (id INT);\n');
  return dir;
}

function checksumOf(dir, name) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex');
}

describe('migration baseline validation', () => {
  test('collects numbered SQL migrations in order', () => {
    const dir = makeMigrationDir();
    fs.writeFileSync(path.join(dir, 'README.md'), '# ignore\n');
    expect(collectMigrationFiles(dir).map((row) => row.name)).toEqual([
      '001_initial_schema.sql',
      '038_shared_vehicle_verification.sql',
    ]);
  });

  test('static baseline rejects future migrations and invalid checksums', () => {
    const dir = makeMigrationDir();
    const invalid = {
      '038_shared_vehicle_verification.sql': {
        tracked_checksum: 'x',
        current_checksum: checksumOf(dir, '038_shared_vehicle_verification.sql'),
        classification: 'legacy-file-drift-do-not-reapply',
      },
    };
    expect(() => validateStaticBaseline(dir, invalid)).toThrow(/Baseline cannot include/);

    const badHash = {
      '001_initial_schema.sql': {
        tracked_checksum: 'x',
        current_checksum: checksumOf(dir, '001_initial_schema.sql'),
        classification: 'legacy-file-drift-do-not-reapply',
      },
    };
    expect(() => validateStaticBaseline(dir, badHash)).toThrow(/Invalid checksum/);
  });

  test('static baseline accepts approved legacy drift when the current hash still matches', () => {
    const dir = makeMigrationDir();
    const baseline = {
      '001_initial_schema.sql': {
        tracked_checksum: '0'.repeat(64),
        current_checksum: checksumOf(dir, '001_initial_schema.sql'),
        classification: 'legacy-file-drift-do-not-reapply',
      },
    };
    expect(validateStaticBaseline(dir, baseline)).toEqual({ approvedLegacyDriftCount: 1 });
  });

  test('database validation rejects untracked and unapproved drift', () => {
    const dir = makeMigrationDir();
    const tracked = {
      '001_initial_schema.sql': '0'.repeat(64),
    };
    expect(() => validateTrackedMigrations(dir, tracked, {})).toThrow(/unapproved checksum drift|untracked/);
  });

  test('database validation accepts an approved legacy drift row', () => {
    const dir = makeMigrationDir();
    const tracked = {
      '001_initial_schema.sql': '0'.repeat(64),
      '038_shared_vehicle_verification.sql': checksumOf(dir, '038_shared_vehicle_verification.sql'),
    };
    const baseline = {
      '001_initial_schema.sql': {
        tracked_checksum: '0'.repeat(64),
        current_checksum: checksumOf(dir, '001_initial_schema.sql'),
        classification: 'legacy-file-drift-do-not-reapply',
      },
    };
    expect(validateTrackedMigrations(dir, tracked, baseline)).toEqual({
      checkedFiles: 2,
      approvedLegacyDriftCount: 1,
    });
    expect(hashFile(path.join(dir, '001_initial_schema.sql'))).toBe(checksumOf(dir, '001_initial_schema.sql'));
  });
});
