'use strict';

/**
 * Deleting an account must release the LINE identity bound to it.
 *
 * Raised by the system owner on 2026-09-07 while binding a second admin
 * account: "บัญชี LINE นี้ถูกผูกกับผู้ดูแลระบบบัญชีอื่นแล้ว" — then asked the
 * right follow-up, what happens when someone changes their LINE.
 *
 * The trap was in account deletion, not in binding. user_recovery_channels
 * carries UNIQUE (provider, provider_subject), so one LINE identity belongs to
 * exactly one account system-wide, and the only release path is the owner
 * unbinding it while signed in: handleUnlinkLine reads req.user and requires
 * `is_active = TRUE AND is_deleted = FALSE`. DELETE /users/:id only set
 * is_deleted, leaving the channel row behind. A soft-deleted account can never
 * sign in, so its LINE identity became permanently unusable — not bindable to
 * any other account, and not releasable by anyone, including an admin.
 *
 * That was reachable in one step from what the owner was doing: bind LINE to a
 * spare admin account, delete the spare, and that person's LINE can never be
 * used for recovery again.
 *
 * The delete handler now performs the same cleanup the owner's own unlink
 * does, inside a transaction, and reports how many bindings it released.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const admin = read('backend/src/routes/admin.routes.js');
const recovery = read('backend/src/routes/adminPasswordRecovery.routes.js');
const migration = read('backend/migrations/049_admin_password_recovery.sql');

function deleteHandler() {
  const start = admin.indexOf("router.delete('/users/:id'");
  expect(start).toBeGreaterThan(-1);
  const end = admin.indexOf("router.post('/users/:id/restore'", start);
  expect(end).toBeGreaterThan(start);
  return admin.slice(start, end);
}

describe('the constraint that makes this matter still exists', () => {
  it('one LINE identity belongs to one account', () => {
    expect(migration).toMatch(/UNIQUE KEY uq_recovery_channel_subject \(provider, provider_subject\)/);
  });

  it('the only owner-driven release requires an active, undeleted account', () => {
    expect(recovery).toMatch(/WHERE id = \? AND role = \? AND is_active = TRUE AND is_deleted = FALSE/);
  });
});

describe('deleting an account releases its recovery binding', () => {
  const body = deleteHandler();

  it('deletes the channel row', () => {
    expect(body).toMatch(/DELETE FROM user_recovery_channels WHERE user_id = \?/);
  });

  it('deletes the recovery codes and any pending reset request', () => {
    expect(body).toMatch(/DELETE FROM user_recovery_codes WHERE user_id = \?/);
    expect(body).toMatch(/DELETE FROM password_reset_requests WHERE user_id = \? AND used_at IS NULL/);
  });

  it('does the cleanup and the soft-delete in one transaction', () => {
    expect(body).toMatch(/beginTransaction/);
    expect(body).toMatch(/commit\(\)/);
    expect(body).toMatch(/rollback\(\)/);
    // The row must be locked before the writes, as the unlink path does.
    expect(body).toMatch(/SELECT id FROM users WHERE id = \? FOR UPDATE/);
    expect(body).toMatch(/UPDATE users SET is_deleted = TRUE, deleted_at = NOW\(\) WHERE id = \?/);
  });

  it('releases the connection whatever happens', () => {
    expect(body).toMatch(/finally\s*\{\s*conn\.release\(\);/);
  });

  it('tells the caller what was released, in the audit trail and the reply', () => {
    expect(body).toMatch(/recovery_channels_released/);
    expect(body).toContain('ปลดการผูกบัญชี LINE');
  });
});

describe('the same cleanup the owner-driven unlink performs', () => {
  it('unlink removes channel, codes and pending requests', () => {
    expect(recovery).toMatch(/DELETE FROM password_reset_requests WHERE user_id = \? AND used_at IS NULL/);
    expect(recovery).toMatch(/DELETE FROM user_recovery_codes WHERE user_id = \?/);
    expect(recovery).toMatch(/DELETE FROM user_recovery_channels WHERE user_id = \? AND provider = 'LINE'/);
  });
});
