'use strict';

/**
 * vehicleDedup.service.js  (Phase 10.13A-15)
 *
 * Read-only plate duplicate preflight. Given a typed plate, returns existing
 * ACTIVE vehicles that are an exact / normalized / province-variant match, so
 * the UI can warn the operator BEFORE creating a duplicate. Source of truth for
 * both the check-plate endpoints and the create-path 409 candidate list.
 *
 * Never writes. Returns only non-sensitive vehicle fields (no driver/parent
 * phone, no LINE ids, no secrets).
 */

const { pool } = require('../config/database');
const { validatePlateNo, isProvinceVariant, normalizePlate, formatPlateDisplay } = require('../utils/vehiclePlate');

const TYPE_ORDER = { EXACT: 0, NORMALIZED: 1, PROVINCE_VARIANT: 2 };

/**
 * @param {string} plateNo - raw plate as typed
 * @returns {Promise<{ status: 'CLEAR'|'DUPLICATE_OR_SIMILAR', candidates: Array }>}
 * @throws 400 (errors:[{code:'VALIDATION_ERROR'}]) when the plate is invalid
 */
async function findPlateMatches(plateNo) {
  const validation = validatePlateNo(plateNo);
  if (!validation.valid) {
    const err = new Error(validation.error);
    err.statusCode = 400;
    err.errors = [{ code: 'VALIDATION_ERROR' }];
    throw err;
  }
  const { trimmed, normalized } = validation;

  // Pull active vehicles that could match: exact plate, exact normalized, or a
  // prefix relation (province present/omitted). isProvinceVariant() filters the
  // prefix hits so different plate NUMBERS are never returned.
  const [rows] = await pool.query(
    `SELECT id, plate_no, normalized_plate, vehicle_type
     FROM vehicles
     WHERE is_deleted = FALSE
       AND (plate_no = ?
            OR normalized_plate = ?
            OR normalized_plate LIKE CONCAT(?, '%')
            OR ? LIKE CONCAT(normalized_plate, '%'))`,
    [trimmed, normalized, normalized, normalized]
  );

  const candidates = [];
  for (const v of rows) {
    let duplicate_type = null;
    if (v.plate_no === trimmed) duplicate_type = 'EXACT';
    else if (v.normalized_plate === normalized) duplicate_type = 'NORMALIZED';
    else if (isProvinceVariant(v.normalized_plate, normalized)) duplicate_type = 'PROVINCE_VARIANT';
    if (duplicate_type) {
      candidates.push({
        vehicle_id: v.id,
        plate_no: v.plate_no,
        normalized_plate: v.normalized_plate,
        vehicle_type: v.vehicle_type || null,
        duplicate_type,
      });
    }
  }
  candidates.sort((a, b) => TYPE_ORDER[a.duplicate_type] - TYPE_ORDER[b.duplicate_type]);

  return { status: candidates.length ? 'DUPLICATE_OR_SIMILAR' : 'CLEAR', candidates };
}

/**
 * Phase 10.13A-22A — annotate a vehicle dropdown list for consistent display
 * and to mark province-variant duplicate rows so the UI can hide them.
 *
 * Each row gets: display_plate (canonical spaced), compact_plate (normalized),
 * duplicate_candidate (bool), canonical_vehicle_id (the row to keep instead).
 *
 * A row is a duplicate_candidate ONLY when it is safe to hide:
 *   - it has 0 active students, AND
 *   - another active row is a province-variant that is clearly more canonical
 *     (has students, OR carries the province this row omits).
 * Rows with students are never marked; ambiguous cases (no clear canonical) are
 * left visible.
 *
 * @param {Array<{id,plate_no,vehicle_type,active_students?}>} rows
 * @returns {Array} enriched rows (never mutates input)
 */
function annotateVehicleList(rows) {
  const enriched = (rows || []).map((v) => ({
    ...v,
    display_plate: formatPlateDisplay(v.plate_no),
    compact_plate: normalizePlate(v.plate_no),
    duplicate_candidate: false,
    canonical_vehicle_id: null,
  }));
  for (const v of enriched) {
    if ((v.active_students || 0) > 0) continue; // never hide a vehicle with students
    const canonical = enriched.find((w) =>
      w.id !== v.id
      && isProvinceVariant(v.compact_plate, w.compact_plate)
      && ((w.active_students || 0) > 0 || w.compact_plate.length > v.compact_plate.length));
    if (canonical) {
      v.duplicate_candidate = true;
      v.canonical_vehicle_id = canonical.id;
    }
  }
  return enriched;
}

// Phase 10.13A-25B — classify an incoming plate against ALL vehicles (active +
// soft-deleted) using the deterministic, province-alias-aware identity module.
// `db` is a pool or a transaction connection. `plateInput` is a structured
// { plate_prefix, plate_number, province } or a legacy plate_no string.
async function classifyPlateAgainstDb(db, plateInput, opts = {}) {
  const { classifyVehiclePlateConflict } = require('../utils/plateIdentity');
  const [vehicles] = await db.query(
    `SELECT v.id, v.plate_no, v.is_deleted,
            (SELECT s.school_id FROM students s
               WHERE s.vehicle_id = v.id AND COALESCE(s.is_deleted, FALSE) = FALSE
               GROUP BY s.school_id ORDER BY COUNT(*) DESC LIMIT 1) AS school_id
     FROM vehicles v`
  );
  return classifyVehiclePlateConflict(plateInput, vehicles, opts);
}

module.exports = { findPlateMatches, annotateVehicleList, classifyPlateAgainstDb };
