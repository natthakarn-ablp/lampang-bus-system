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
const { validatePlateNo, isProvinceVariant } = require('../utils/vehiclePlate');

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

module.exports = { findPlateMatches };
