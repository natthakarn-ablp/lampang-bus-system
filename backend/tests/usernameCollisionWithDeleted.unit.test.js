'use strict';

/**
 * Creating an account must not fail with a raw database error.
 *
 * Reported by the system owner on 2026-09-07: creating a new admin account
 * answered "Duplicate entry — record already exists" — the untranslated
 * fallback in backend/src/middleware/errorHandler.js for ER_DUP_ENTRY.
 *
 * Cause: `uq_users_username` is a plain UNIQUE index, so it also covers rows
 * that were soft-deleted (is_deleted = TRUE). All three account-creation paths
 * checked for duplicates with `AND is_deleted = FALSE`, so a name held by a
 * removed account looked free, the INSERT reached the database, and the
 * database refused it. Production holds 40 soft-deleted users — including
 * `Testadmin`, an admin account removed on 2026-08-26 — so reusing an obvious
 * name was enough to hit it.
 *
 * The fix is the same in all three places: look the name up regardless of
 * is_deleted, and say which case it is. A name held by a deleted account is
 * recoverable — an admin can restore it (adminSvc.restoreUser) — so the
 * message says that rather than leaving the operator stuck.
 *
 * These are source-level guards; the routes need a database to exercise
 * directly and the DB-free suite is what runs on deploy (handoff §5).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SITES = [
  ['backend/src/routes/admin.routes.js', 'admin creates any user'],
  ['backend/src/routes/school.routes.js', 'school creates a teacher sub-account'],
  ['backend/src/services/affiliationAdmin.service.js', 'affiliation creates a school account'],
];

describe('the duplicate-username check sees soft-deleted rows', () => {
  it.each(SITES)('%s (%s) no longer filters them out', (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/FROM users WHERE username = \?\s+AND is_deleted = FALSE/);
    expect(src).not.toMatch(/SELECT id FROM users WHERE username = \? AND is_deleted = FALSE/);
  });

  it.each(SITES)('%s selects is_deleted so it can tell the two cases apart', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/SELECT id, is_deleted FROM users WHERE username = \?/);
  });

  it.each(SITES)('%s explains a name held by a deleted account', (rel) => {
    const src = read(rel);
    expect(src).toContain('บัญชีที่ถูกลบไปแล้ว');
    // and still answers the plain case the old way
    expect(src).toContain('มีอยู่ในระบบแล้ว');
  });
});

describe('the admin path gives the operator a way forward', () => {
  const src = read('backend/src/routes/admin.routes.js');

  it('names the deleted account so it can be restored', () => {
    expect(src).toContain('USERNAME_TAKEN_BY_DELETED');
    expect(src).toMatch(/deleted_user_id: existing\.id/);
  });

  it('points at the restore path that exists', () => {
    expect(src).toContain('กู้คืนบัญชีเดิม');
    // restoreUser is the service behind POST /users/:id/restore
    expect(read('backend/src/services/admin.service.js')).toMatch(/async function restoreUser/);
  });
});

describe('the unique index this depends on is still global', () => {
  it('schema.sql declares UNIQUE KEY uq_users_username with no is_deleted term', () => {
    const schema = read('backend/tests/schema.sql');
    expect(schema).toMatch(/UNIQUE KEY `uq_users_username` \(`username`\)/);
  });
});
