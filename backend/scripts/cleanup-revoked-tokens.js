'use strict';

// Refresh-token blacklist cleanup (CLAUDE.md §5.1). A revoked_tokens row only
// needs to live until the token it blacklists would have expired anyway, so we
// delete rows with expires_at < NOW(). Dry-run by DEFAULT; pass --apply to
// actually delete. Cron (Bangkok): `0 3 * * *  node scripts/cleanup-revoked-tokens.js --apply`.

const { pool } = require('../src/config/database');

async function main() {
  const apply = process.argv.includes('--apply');
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM revoked_tokens WHERE expires_at < NOW()');
  if (!apply) {
    console.log(`[cleanup-revoked] DRY-RUN · ${n} expired token(s) eligible (run with --apply to delete)`);
  } else {
    const [r] = await pool.query('DELETE FROM revoked_tokens WHERE expires_at < NOW()');
    console.log(`[cleanup-revoked] APPLY · deleted ${r.affectedRows} expired token(s)`);
  }
  await pool.end();
}

if (require.main === module) {
  main().catch((e) => { console.error('[cleanup-revoked] FATAL:', e.message); pool.end().catch(() => {}); process.exit(1); });
}

module.exports = { main };
