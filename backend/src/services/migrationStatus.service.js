'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

/**
 * Read the migration ledger against the files shipped with this checkout.
 * The public health endpoint and the operator health report deliberately share
 * this function so their pending count cannot drift apart.
 */
async function getMigrationStatus(pool) {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const [trackedRows] = await pool.query('SELECT filename, checksum FROM schema_migrations');
  const tracked = new Map(trackedRows.map((row) => [row.filename, row.checksum]));

  let pending = 0;
  let drift = 0;
  for (const file of files) {
    if (!tracked.has(file)) {
      pending += 1;
      continue;
    }
    const checksum = crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(MIGRATIONS_DIR, file)))
      .digest('hex');
    if (tracked.get(file) && tracked.get(file) !== checksum) drift += 1;
  }

  const latest = [...tracked.keys()].sort().at(-1) || null;
  return { latest, pending, drift };
}

module.exports = { MIGRATIONS_DIR, getMigrationStatus };
