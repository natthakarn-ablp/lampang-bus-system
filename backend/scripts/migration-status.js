'use strict';

// Phase 10.13A-27 — migration status reporter.
// Lists every migration file in backend/migrations/ alongside its tracked state
// in the schema_migrations table (filename + sha256 checksum). Read-only.
//
// Usage:  node backend/scripts/migration-status.js
//         node backend/scripts/migration-status.js --json
//         node backend/scripts/migration-status.js --backfill   (records all
//             present-but-untracked files as 'verified-present-existing')
//
// --backfill is the only writing mode; it inserts metadata rows only (no schema
// change) and never overwrites an existing tracking row.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('../src/config/database');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const backfill = args.includes('--backfill');

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  let tracked = {};
  try {
    const [rows] = await pool.query('SELECT filename, checksum, status, notes, applied_at FROM schema_migrations');
    tracked = Object.fromEntries(rows.map((r) => [r.filename, r]));
  } catch (e) {
    console.error('schema_migrations table not found — apply migration 028 first. (' + e.code + ')');
    await pool.end();
    process.exit(2);
  }

  const report = files.map((f) => {
    const checksum = sha256(path.join(MIGRATIONS_DIR, f));
    const t = tracked[f];
    let state = 'UNTRACKED';
    if (t) state = (t.checksum && t.checksum !== checksum) ? 'CHECKSUM_DRIFT' : (t.status || 'tracked');
    return { filename: f, checksum: checksum.slice(0, 12), state, notes: t ? t.notes : null };
  });

  if (backfill) {
    let added = 0;
    for (const f of files) {
      if (tracked[f]) continue;
      await pool.query(
        'INSERT IGNORE INTO schema_migrations (filename, checksum, applied_by, status, notes) VALUES (?, ?, ?, ?, ?)',
        [f, sha256(path.join(MIGRATIONS_DIR, f)), 'migration-status.js', 'verified-present-existing', 'backfilled: schema reflects this migration in production']
      );
      added++;
    }
    console.log(`backfill: recorded ${added} previously-untracked migration(s).`);
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('migration                              checksum      state');
    console.log('-------------------------------------- ------------- ----------------------------');
    for (const r of report) {
      console.log(r.filename.padEnd(38) + ' ' + r.checksum.padEnd(13) + ' ' + r.state + (r.notes ? '  (' + r.notes + ')' : ''));
    }
    const untracked = report.filter((r) => r.state === 'UNTRACKED').length;
    const drift = report.filter((r) => r.state === 'CHECKSUM_DRIFT').length;
    console.log(`\n${report.length} migration files · ${untracked} untracked · ${drift} checksum-drift`);
  }
  await pool.end();
}

main().catch((e) => { console.error('migration-status error:', e.message); process.exit(1); });
