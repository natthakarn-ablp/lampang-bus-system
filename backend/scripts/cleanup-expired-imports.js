'use strict';

// Phase 10.13A-27 — clean up expired retained import files.
// 10.13A-26A keeps preview uploads + sets import_batches.expires_at = +14 days.
// This removes only the retained FILE for batches past expires_at; it does NOT
// delete import_batches / import_batch_rows (the row-level audit trail stays).
//
// Usage:  node backend/scripts/cleanup-expired-imports.js --dry-run   (default)
//         node backend/scripts/cleanup-expired-imports.js --apply
//
// Safety: only deletes files whose stored_file_path resolves INSIDE the
// controlled import upload directory (path-traversal guard). Defaults to
// dry-run; --apply is required to actually delete.

const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

const IMPORT_DIR = path.resolve(path.join(__dirname, '../uploads/imports'));

function insideImportDir(p) {
  if (!p) return false;
  const resolved = path.resolve(p);
  return resolved === IMPORT_DIR || resolved.startsWith(IMPORT_DIR + path.sep);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const mode = apply ? 'APPLY' : 'DRY-RUN';

  const [batches] = await pool.query(
    `SELECT id, school_id, stored_file_path, DATE_FORMAT(expires_at,'%Y-%m-%d') AS expires_at
       FROM import_batches
      WHERE expires_at IS NOT NULL AND expires_at < NOW() AND stored_file_path IS NOT NULL
      ORDER BY id`
  );

  let removed = 0, skippedMissing = 0, skippedUnsafe = 0;
  console.log(`[cleanup-imports] mode=${mode} · ${batches.length} expired batch(es) with a retained path`);
  for (const b of batches) {
    const p = b.stored_file_path;
    if (!insideImportDir(p)) { skippedUnsafe++; console.log(`  batch #${b.id}: SKIP (path outside import dir) ${p}`); continue; }
    if (!fs.existsSync(p)) { skippedMissing++; console.log(`  batch #${b.id}: file already gone (expired ${b.expires_at})`); continue; }
    if (apply) {
      fs.unlinkSync(p);
      removed++;
      console.log(`  batch #${b.id}: REMOVED ${path.basename(p)} (expired ${b.expires_at})`);
    } else {
      console.log(`  batch #${b.id}: would remove ${path.basename(p)} (expired ${b.expires_at})`);
    }
  }
  console.log(`[cleanup-imports] ${mode} done · ${apply ? removed + ' removed' : (batches.length - skippedMissing - skippedUnsafe) + ' would be removed'} · ${skippedMissing} already-gone · ${skippedUnsafe} unsafe-skipped`);
  console.log('[cleanup-imports] row-level results in import_batch_rows are preserved (audit trail).');
  console.log('[cleanup-imports] suggested cron: 30 3 * * *  node backend/scripts/cleanup-expired-imports.js --apply');
  await pool.end();
}

module.exports = { insideImportDir, IMPORT_DIR };

if (require.main === module) {
  main().catch((e) => { console.error('cleanup-imports error:', e.message); process.exit(1); });
}
