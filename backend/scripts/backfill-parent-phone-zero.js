'use strict';

/**
 * Backfill parents.phone to the canonical 10-digit form (readiness parent-02).
 *
 * Before the shared normalizePhone (src/utils/phone.js), the preview importer
 * stored only the digits of the phone cell. An Excel cell formatted as a number
 * turns 0812345678 into 812345678, so those parents could never link LINE
 * (the bind lookup is an exact match on parents.phone) and never received a
 * notification (checkin.service joins line_bindings on the same column).
 *
 * This rewrites every ACTIVE parent whose phone normalizes to a different,
 * valid value — the same rule every importer now applies:
 *   812345678      → 0812345678   (9 digits starting 6/8/9: lost leading 0)
 *   081-234-5678   → 0812345678   (separators)
 *   +66812345678   → 0812345678
 * Phones that still are not 10 digits after normalizing are NOT changed; they
 * are counted and listed (masked) so the school can correct them.
 *
 * Several parents rows may share one phone by design (one row per child), so
 * a normalized phone that already exists on another row is not a conflict.
 *
 * Dry run by default; --apply writes, in one transaction, with a guarded
 * UPDATE (WHERE id = ? AND phone = <old value>) so a row edited meanwhile is
 * left alone, plus one audit_logs row. Idempotent: a second run finds nothing.
 * Uses the runtime DB connection (src/config/database, the app's .env user).
 *
 * Usage (from backend/):
 *   node scripts/backfill-parent-phone-zero.js            # dry run
 *   node scripts/backfill-parent-phone-zero.js --apply
 */

const { normalizePhone, isValidPhone } = require('../src/utils/phone');
const { maskPhone } = require('../src/utils/studentImportClassifier');

const SAMPLE_SIZE = 10;

/**
 * Pure planning step: which rows change, and which cannot be fixed.
 * @param {{id:number, phone:string}[]} rows active parents with a phone
 */
function planBackfill(rows) {
  const updates = [];
  const invalid = [];
  let unchanged = 0;
  for (const row of rows) {
    const current = row.phone == null ? '' : String(row.phone);
    if (!current.trim()) continue;
    const next = normalizePhone(current);
    if (next === current) {
      if (isValidPhone(current)) unchanged++;
      else invalid.push({ id: row.id, phone: current });
      continue;
    }
    if (isValidPhone(next)) updates.push({ id: row.id, from: current, to: next });
    else invalid.push({ id: row.id, phone: current });
  }
  return { updates, invalid, unchanged };
}

function printPlan(plan, apply) {
  const mode = apply ? 'APPLY' : 'DRY-RUN';
  console.log(`[backfill-parent-phone] ${mode} · ${plan.updates.length} to fix · ${plan.unchanged} already canonical · ${plan.invalid.length} invalid (left unchanged)`);
  for (const u of plan.updates.slice(0, SAMPLE_SIZE)) {
    console.log(`  fix   parent #${u.id}: ${maskPhone(u.from)} (${String(u.from).replace(/\D/g, '').length} digits) -> ${maskPhone(u.to)}`);
  }
  if (plan.updates.length > SAMPLE_SIZE) console.log(`  ... and ${plan.updates.length - SAMPLE_SIZE} more`);
  for (const r of plan.invalid.slice(0, SAMPLE_SIZE)) {
    console.log(`  check parent #${r.id}: ${maskPhone(r.phone)} (${String(r.phone).replace(/\D/g, '').length} digits) — not a 10-digit phone, needs the school to correct it`);
  }
  if (plan.invalid.length > SAMPLE_SIZE) console.log(`  ... and ${plan.invalid.length - SAMPLE_SIZE} more`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { pool } = require('../src/config/database');
  const { logAudit } = require('../src/utils/audit');
  try {
    const [rows] = await pool.query(
      `SELECT id, phone FROM parents
        WHERE is_deleted = FALSE AND phone IS NOT NULL AND TRIM(phone) <> ''
        ORDER BY id`
    );
    const plan = planBackfill(rows);
    printPlan(plan, apply);
    if (!apply) {
      if (plan.updates.length) console.log('[backfill-parent-phone] dry run only — rerun with --apply to write');
      return;
    }
    if (!plan.updates.length) {
      console.log('[backfill-parent-phone] nothing to do');
      return;
    }

    const conn = await pool.getConnection();
    let changed = 0;
    try {
      await conn.beginTransaction();
      for (const u of plan.updates) {
        const [res] = await conn.query(
          'UPDATE parents SET phone = ? WHERE id = ? AND phone = ? AND is_deleted = FALSE',
          [u.to, u.id, u.from]
        );
        changed += res.affectedRows || 0;
      }
      await logAudit({
        action: 'UPDATE',
        entityType: 'parent_phone_backfill',
        entityId: 'parent-02',
        newValue: { rows_updated: changed, planned: plan.updates.length, invalid_left: plan.invalid.length },
        conn,
        required: true,
      });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    console.log(`[backfill-parent-phone] APPLIED · ${changed} rows updated (${plan.updates.length - changed} skipped: changed since read)`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[backfill-parent-phone] error:', err.message);
    process.exit(1);
  });
}

module.exports = { planBackfill };
