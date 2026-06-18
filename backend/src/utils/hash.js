'use strict';

const crypto = require('crypto');

/**
 * Hash a Thai national ID (13 digits).
 * The raw CID is never stored in the database.
 *
 * Audit 2026-06-18 (auth-crypto): a plain unsalted SHA-256 over a 13-digit national
 * ID is brute-forceable from a leaked DB (the keyspace is ~10^11). When a secret
 * server-side pepper is configured (CID_HASH_PEPPER), this uses keyed HMAC-SHA256 so
 * an exfiltrated DB alone cannot be reversed. The pepper is OPT-IN to stay backward
 * compatible: existing rows were written with plain SHA-256 and can only be
 * re-hashed from the original source CIDs (one-way). To roll it out:
 *   1. set CID_HASH_PEPPER (≥32 random chars) in the backend env,
 *   2. run `node backend/scripts/rehash-cid.js` to re-hash students from input/*.xlsx,
 *   3. deploy. New imports then use HMAC automatically.
 * Until step 2 is done the pepper MUST stay unset, or cid_hash lookups won't match
 * the legacy rows.
 *
 * @param {string} cid - 13-digit national ID string
 * @returns {string} 64-character hex digest
 */
function hashCid(cid) {
  if (!cid) throw new Error('CID is required for hashing');
  const pepper = process.env.CID_HASH_PEPPER || '';
  const value = String(cid).trim();
  if (pepper) {
    return crypto.createHmac('sha256', pepper).update(value).digest('hex');
  }
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Generate a vehicle ID in the format used by the legacy system.
 * Format: 'V-' + first 12 hex chars of SHA-256(plate_no)
 *
 * @param {string} plateNo - Vehicle plate number
 * @returns {string} e.g. 'V-c80d811728f3'
 */
function generateVehicleId(plateNo) {
  if (!plateNo) throw new Error('plate_no is required to generate vehicle ID');
  const hash = crypto
    .createHash('sha256')
    .update(String(plateNo).trim())
    .digest('hex');
  return `V-${hash.substring(0, 12)}`;
}

module.exports = { hashCid, generateVehicleId };
