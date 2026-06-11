'use strict';

// Phase 10.13B-2 — atomic id allocator backed by the id_sequences table.
// Replaces the SELECT MAX(id)+1 fallback so concurrent student inserts cannot
// race. MUST be called inside an existing transaction (the caller's `conn`):
// the row lock (FOR UPDATE) serializes concurrent allocators and the increment
// commits/rolls back atomically with the insert that consumes the id.

/**
 * Allocate the next id for a named sequence. Locks the sequence row for the
 * duration of the caller's transaction.
 * @param {object} conn  an open mysql2 connection inside a transaction
 * @param {string} sequenceName  e.g. 'students'
 * @returns {Promise<number>} a unique id
 */
async function allocateId(conn, sequenceName) {
  const [[row]] = await conn.query(
    'SELECT next_value FROM id_sequences WHERE name = ? FOR UPDATE',
    [sequenceName]
  );
  if (!row) {
    const e = new Error(`id_sequences row '${sequenceName}' is missing — run migration 029`);
    e.statusCode = 500;
    throw e;
  }
  const id = Number(row.next_value);
  await conn.query(
    'UPDATE id_sequences SET next_value = next_value + 1 WHERE name = ?',
    [sequenceName]
  );
  return id;
}

const allocateStudentId = (conn) => allocateId(conn, 'students');

module.exports = { allocateId, allocateStudentId };
