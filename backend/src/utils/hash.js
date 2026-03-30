'use strict';

const crypto = require('crypto');

/**
 * Hash a Thai national ID (13 digits) with SHA-256.
 * The raw CID is never stored in the database.
 *
 * @param {string} cid - 13-digit national ID string
 * @returns {string} 64-character hex SHA-256 digest
 */
function hashCid(cid) {
  if (!cid) throw new Error('CID is required for hashing');
  return crypto.createHash('sha256').update(String(cid).trim()).digest('hex');
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
