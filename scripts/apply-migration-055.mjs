#!/usr/bin/env node
// Targeted operator-only runner for migration 055. Default/dry run never reads
// credentials or the DB. --apply creates ONE new empty table; --verify is read-only.
import { readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync, rmdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// A server-only release-prep clone may reuse the live, unchanged backend dependencies.
const require = createRequire(resolve(process.env.MIGRATION_BACKEND_MODULES || resolve(root, 'backend'), 'package.json'));
const { filename, applyPromotionMigration, verifyPromotionMigration } = require(resolve(root, 'backend/src/services/schoolYearPromotionMigration.service.js'));
const sql = readFileSync(resolve(root, 'backend/migrations', filename), 'utf8');
const checksum = createHash('sha256').update(sql).digest('hex');
function preflight(message) { const error = new Error(message); error.code = 'OPERATOR_PREFLIGHT'; throw error; }
const applying = process.argv.includes('--apply');
const verifying = process.argv.includes('--verify');
if (!applying && !verifying) {
  console.log(JSON.stringify({ dry_run: true, filename, checksum, note: 'No DB, credentials, backup or lock operation performed' }));
} else {
  let conn, held = false;
  const lock = process.env.SELF_TRAVEL_DEPLOY_LOCK || '/home/schoolbus/deploy-state/deploy-backend.lock';
  const owner = resolve(lock, 'owner.' + process.pid);
  try {
    if (applying && verifying) preflight('Select only one mode: apply or read-only verify');
    if (process.getuid?.() === 0) preflight('Do not run repository Node code as root; use the approved owner SQL operation separately');
    if (!process.env.ENV_FILE) preflight('ENV_FILE must select the existing private operator configuration');
    const cfg = require('dotenv').parse(readFileSync(process.env.ENV_FILE));
    if (applying && String(cfg.DB_CREDENTIAL_ROLE || '').trim().toLowerCase() === 'runtime') preflight('Runtime credentials cannot apply schema; read-only verify is available');
    if (!cfg.DB_USER || !cfg.DB_NAME || !cfg.DB_PASSWORD) preflight('Operator configuration is incomplete');
    if (applying) {
      mkdirSync(lock); held = true;
      writeFileSync(owner + '.tmp', process.pid + ' ' + new Date().toISOString() + ' migration055\n', { mode: 0o600 });
      renameSync(owner + '.tmp', owner);
      // Verifier prints only server-local backup metadata, never dump contents.
      execFileSync('bash', [resolve(root, 'scripts/verify-latest-backup.sh')], { cwd: root, stdio: 'inherit' });
    }
    conn = await require('mysql2/promise').createConnection({
      host: cfg.DB_HOST || '127.0.0.1', port: Number(cfg.DB_PORT || 3306), user: cfg.DB_USER,
      password: cfg.DB_PASSWORD, database: cfg.DB_NAME, multipleStatements: false,
    });
    console.log(JSON.stringify(applying ? await applyPromotionMigration(conn, { sql, checksum })
      : await verifyPromotionMigration(conn, { checksum })));
  } catch (error) {
    // Do not echo connection errors: they can contain usernames and addresses.
    console.error('[055] refused/failed:', ['PROMOTION_MIGRATION_REFUSED', 'OPERATOR_PREFLIGHT'].includes(error.code) ? error.message : (error.code || 'operator preflight failed'));
    process.exitCode = 1;
  } finally {
    try { if (conn) await conn.end(); }
    finally {
      if (held) {
        try { unlinkSync(owner); } catch { /* missing marker only */ }
        try { unlinkSync(owner + '.tmp'); } catch { /* missing temporary only */ }
        try { rmdirSync(lock); } catch { console.error('[055] lock directory retained; inspect without deleting another owner'); process.exitCode = 1; }
      }
    }
  }
}
