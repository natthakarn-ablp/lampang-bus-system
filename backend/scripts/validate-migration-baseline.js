#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');

const DEFAULT_MIGRATION_DIR = path.join(__dirname, '../migrations');
const DEFAULT_BASELINE_PATH = path.join(DEFAULT_MIGRATION_DIR, 'legacy-drift-baseline.json');
const LEGACY_CLASSIFICATION = 'legacy-file-drift-do-not-reapply';
const HASH_RE = /^[a-f0-9]{64}$/;

function migrationNumber(name) {
  return Number(name.slice(0, 3));
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function collectMigrationFiles(migrationDir = DEFAULT_MIGRATION_DIR) {
  return fs.readdirSync(migrationDir)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()
    .map((name) => ({
      name,
      number: migrationNumber(name),
      path: path.join(migrationDir, name),
    }));
}

function readBaselineObject(baselinePath = DEFAULT_BASELINE_PATH) {
  if (!fs.existsSync(baselinePath)) {
    throw new Error('legacy-drift-baseline.json is missing');
  }
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
}

function validateStaticBaseline(migrationDir = DEFAULT_MIGRATION_DIR, baseline = readBaselineObject()) {
  const byName = Object.fromEntries(collectMigrationFiles(migrationDir).map((file) => [file.name, file]));
  for (const [name, row] of Object.entries(baseline)) {
    const file = byName[name];
    if (!file) throw new Error(`Baseline references missing migration: ${name}`);
    if (file.number >= 38) throw new Error(`Baseline cannot include ${name}`);
    if (row.classification !== LEGACY_CLASSIFICATION) throw new Error(`Invalid classification: ${name}`);
    if (!HASH_RE.test(row.tracked_checksum || '') || !HASH_RE.test(row.current_checksum || '')) {
      throw new Error(`Invalid checksum: ${name}`);
    }
    if (hashFile(file.path) !== row.current_checksum) {
      throw new Error(`Repository drift changed again: ${name}`);
    }
  }
  return { approvedLegacyDriftCount: Object.keys(baseline).length };
}

function validateTrackedMigrations(migrationDir = DEFAULT_MIGRATION_DIR, tracked = {}, baseline = readBaselineObject()) {
  validateStaticBaseline(migrationDir, baseline);
  const errors = [];
  for (const file of collectMigrationFiles(migrationDir)) {
    const current = hashFile(file.path);
    const stored = tracked[file.name];
    if (!stored) {
      errors.push(`${file.name}: untracked`);
      continue;
    }
    if (stored !== current) {
      const approved = baseline[file.name];
      if (!approved || approved.tracked_checksum !== stored || approved.current_checksum !== current) {
        errors.push(`${file.name}: unapproved checksum drift`);
      }
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return {
    checkedFiles: collectMigrationFiles(migrationDir).length,
    approvedLegacyDriftCount: Object.keys(baseline).length,
  };
}

function captureLegacyBaseline(migrationDir = DEFAULT_MIGRATION_DIR, tracked = {}) {
  const captured = {};
  for (const file of collectMigrationFiles(migrationDir)) {
    if (file.number >= 38) continue;
    const current = hashFile(file.path);
    const stored = tracked[file.name];
    if (stored && stored !== current) {
      captured[file.name] = {
        tracked_checksum: stored,
        current_checksum: current,
        classification: LEGACY_CLASSIFICATION,
      };
    }
  }
  return captured;
}

async function readTrackedFromDatabase() {
  require('dotenv').config({ path: path.join(__dirname, '../.env') });
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  const [rows] = await connection.query('SELECT filename, checksum FROM schema_migrations');
  await connection.end();
  return Object.fromEntries(rows.map((row) => [row.filename, row.checksum]));
}

async function main() {
  const mode = process.argv.includes('--capture') ? 'capture' : process.argv.includes('--db') ? 'db' : 'static';
  if (mode === 'static') {
    const result = validateStaticBaseline(DEFAULT_MIGRATION_DIR, readBaselineObject(DEFAULT_BASELINE_PATH));
    console.log(`[migrations] static baseline OK (${result.approvedLegacyDriftCount} approved legacy drift rows)`);
    return;
  }

  const tracked = await readTrackedFromDatabase();
  if (mode === 'capture') {
    const captured = captureLegacyBaseline(DEFAULT_MIGRATION_DIR, tracked);
    fs.writeFileSync(DEFAULT_BASELINE_PATH, `${JSON.stringify(captured, null, 2)}\n`);
    console.log(`[migrations] captured ${Object.keys(captured).length} legacy drift rows`);
    return;
  }

  const result = validateTrackedMigrations(DEFAULT_MIGRATION_DIR, tracked, readBaselineObject(DEFAULT_BASELINE_PATH));
  console.log(`[migrations] database tracking OK (${result.checkedFiles} files, ${result.approvedLegacyDriftCount} approved legacy drift rows)`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[migrations]', error.message);
    process.exit(1);
  });
}

module.exports = {
  LEGACY_CLASSIFICATION,
  collectMigrationFiles,
  hashFile,
  validateStaticBaseline,
  validateTrackedMigrations,
  captureLegacyBaseline,
};
