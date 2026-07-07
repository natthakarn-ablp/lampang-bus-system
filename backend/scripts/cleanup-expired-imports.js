'use strict';

// Phase 10.13A-27 — clean up expired retained import files.
// 10.13A-26A keeps preview uploads + sets import_batches.expires_at = +14 days.
// This removes only the retained FILE for batches past expires_at; it does NOT
// delete import_batches / import_batch_rows (the row-level audit trail stays).
//
// Bug fix (2026-07-07, Bug #1 + #3):
//   - When a file is removed (or found already gone), the corresponding
//     import_batches.stored_file_path is now set to NULL. Previously the file
//     was deleted but the row kept its path, so this script kept reporting the
//     batch as expired forever and the integrity monitor counted it every day.
//   - Added an orphan-file sweep at the end: any file inside IMPORT_DIR that no
//     import_batches row points at is removed too (covers files left behind by
//     rejected previews that never created an import_batches row — e.g. .xls
//     uploads rejected for being the wrong format).
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
  // Bug #1 fix — track batch ids whose stored_file_path we need to NULL out,
  // whether the file was just removed or was already missing. Without this,
  // the row kept pointing at a deleted path and the integrity monitor counted
  // it as an expired file forever.
  const clearPathIds = [];
  console.log(`[cleanup-imports] mode=${mode} · ${batches.length} expired batch(es) with a retained path`);
  for (const b of batches) {
    const p = b.stored_file_path;
    if (!insideImportDir(p)) { skippedUnsafe++; console.log(`  batch #${b.id}: SKIP (path outside import dir) ${p}`); continue; }
    if (!fs.existsSync(p)) {
      skippedMissing++;
      console.log(`  batch #${b.id}: file already gone (expired ${b.expires_at}) — clearing stored_file_path`);
      clearPathIds.push(b.id);
      continue;
    }
    if (apply) {
      fs.unlinkSync(p);
      removed++;
      clearPathIds.push(b.id);
      console.log(`  batch #${b.id}: REMOVED ${path.basename(p)} (expired ${b.expires_at})`);
    } else {
      console.log(`  batch #${b.id}: would remove ${path.basename(p)} (expired ${b.expires_at})`);
    }
  }
  // Bug #1 fix — NULL out stored_file_path so the row no longer points at a
  // gone/just-removed file. Only under --apply. Bounded UPDATE.
  if (apply && clearPathIds.length) {
    const placeholders = clearPathIds.map(() => '?').join(',');
    await pool.query(
      `UPDATE import_batches SET stored_file_path = NULL WHERE id IN (${placeholders})`,
      clearPathIds
    );
    console.log(`[cleanup-imports] cleared stored_file_path on ${clearPathIds.length} batch(es)`);
  }

  // ── Bug #3 fix — orphan-file sweep ──────────────────────────────────────────
  // Remove files inside IMPORT_DIR that NO import_batches row references. This
  // catches uploads from rejected previews (e.g. .xls rejected at validation
  // time) that never got a batch row and therefore were never swept above.
  // Same path-traversal guard applies implicitly (we only read IMPORT_DIR).
  const [active] = await pool.query(
    "SELECT DISTINCT stored_file_path FROM import_batches WHERE stored_file_path IS NOT NULL"
  );
  const referenced = new Set(active.map((r) => path.resolve(r.stored_file_path)));
  let orphanRemoved = 0;
  let orphanFiles = [];
  if (fs.existsSync(IMPORT_DIR)) {
    orphanFiles = fs.readdirSync(IMPORT_DIR)
      .filter((f) => {
        const full = path.join(IMPORT_DIR, f);
        return fs.statSync(full).isFile() && !referenced.has(full);
      });
  }
  for (const f of orphanFiles) {
    const full = path.join(IMPORT_DIR, f);
    if (apply) {
      fs.unlinkSync(full);
      orphanRemoved++;
    }
  }
  if (orphanFiles.length) {
    console.log(`[cleanup-imports] orphan sweep: ${apply ? orphanRemoved + ' removed' : orphanFiles.length + ' would be removed'} (files not referenced by any batch)`);
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
