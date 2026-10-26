'use strict';

const isDeadlock = error => error && (error.code === 'ER_LOCK_DEADLOCK' || error.errno === 1213);

/** Retry a complete DB-only transaction after a confirmed InnoDB deadlock.
 * Never use for callbacks with network sends or other non-transactional effects.
 * Connection loss/ambiguous commits and long lock timeouts are not retried.
 */
async function withDeadlockRetry(pool, begin, work) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const conn = await pool.getConnection();
    try {
      await begin(conn);
      const result = await work(conn);
      await conn.commit();
      return result;
    } catch (error) {
      try { await conn.rollback(); } catch { /* preserve the original DB error */ }
      if (!isDeadlock(error) || attempt === 3) throw error;
    } finally {
      conn.release();
    }
    // Release the connection before waiting; allow the competing batch to finish.
    await new Promise(resolve => setTimeout(resolve, 20 * (2 ** attempt)));
  }
}

module.exports = { withDeadlockRetry, isDeadlock };
