'use strict';

// Phase 10.13B-3 — backfill vehicles.canonical_plate from plate_no using the
// province-alias-aware plateIdentity logic. Idempotent (recomputes every run).
// active_canonical_plate (generated column) updates automatically. NULL is
// stored for unparseable or province-less plates so uniqueness is never enforced
// on an ambiguous plate.
//
// Usage:  node backend/scripts/backfill-canonical-plate.js [--dry-run]

const { pool } = require('../src/config/database');
const PI = require('../src/utils/plateIdentity');

// Single source of truth — the same helper the route INSERTs use, so the
// backfilled canonical can never drift from runtime-computed values.
const canonicalFor = PI.canonicalPlateForStorage;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const [vehicles] = await pool.query('SELECT id, plate_no, is_deleted, canonical_plate FROM vehicles');
  let updated = 0, nulled = 0, unchanged = 0;
  const ambiguous = [];
  for (const v of vehicles) {
    const c = canonicalFor(v.plate_no);
    if (c === null && !v.is_deleted) ambiguous.push(v.plate_no);
    if ((v.canonical_plate || null) === (c || null)) { unchanged++; continue; }
    if (!dryRun) await pool.query('UPDATE vehicles SET canonical_plate = ? WHERE id = ?', [c, v.id]);
    if (c === null) nulled++; else updated++;
  }
  console.log(`[backfill-canonical] ${dryRun ? 'DRY-RUN' : 'APPLIED'} · ${vehicles.length} vehicles · ${updated} set · ${nulled} nulled · ${unchanged} unchanged`);
  console.log(`[backfill-canonical] ${ambiguous.length} ACTIVE ambiguous (no province / unparseable) → active_canonical_plate stays NULL (not uniqueness-enforced): ${ambiguous.slice(0, 10).join(' | ')}`);
  await pool.end();
}

main().catch((e) => { console.error('backfill-canonical error:', e.message); process.exit(1); });
