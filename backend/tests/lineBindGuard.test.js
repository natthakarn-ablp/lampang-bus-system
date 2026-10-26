'use strict';

/**
 * lineBindGuard.test.js — Phase 10.13C-4A, updated for A1-9.
 *
 * Proves a brute-force is locked by the CREDENTIAL (phone / student / pair /
 * sub), so rotating the source IP does not help, and that no key ever holds a
 * raw phone number.
 *
 * WHY THIS IS NO LONGER A PURE UNIT TEST
 * --------------------------------------
 * It used to say "No DB, no network, no app" and drove a fake clock through
 * guard.__setClock(). The counters have moved into line_bind_lockouts
 * (migration 051) because a Map in one process meant N instances each enforcing
 * their own ceiling of 5, and a deploy releasing every lockout in force.
 *
 * With the state in the database, the expiry comparisons happen inside MySQL
 * against its NOW(). A fake clock in this process cannot move them, so a test
 * that kept one would be asserting against a clock nothing reads. __advance()
 * does the honest equivalent: it ages the rows. Everything the old file
 * asserted is still asserted here, against the store that now decides.
 */

const guard = require('../src/services/lineBindGuard');
const { pool } = require('../src/config/database');

beforeEach(async () => { await guard.__reset(); });
afterAll(async () => { await guard.__reset(); });

const cred = { phone: '0811112222', studentKey: '21199', sub: 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01' };

test('pair locks after 5 failures (POLICY.pair.max)', async () => {
  const keys = guard.keysFor(cred);
  for (let i = 0; i < 4; i++) {
    await guard.noteFailure(keys);
    expect(`after ${i + 1}: ${(await guard.checkLock(keys)).locked}`).toBe(`after ${i + 1}: false`);
  }
  await guard.noteFailure(keys); // 5th
  const lock = await guard.checkLock(keys);
  expect(lock.locked).toBe(true);
  expect(lock.which).toBe('pair');
  expect(lock.reason).toBe('LOCKED_PAIR');
  expect(lock.retryAfterSec).toBeGreaterThan(0);
});

test('rotating IP cannot bypass — lock is keyed on the credential, not the request', async () => {
  const keys = guard.keysFor(cred);
  for (let i = 0; i < 5; i++) await guard.noteFailure(keys);
  // A "new IP" recomputes the SAME hashed credential keys → still locked.
  const sameCredFreshKeys = guard.keysFor({ phone: cred.phone, studentKey: cred.studentKey });
  expect((await guard.checkLock(sameCredFreshKeys)).locked).toBe(true);
});

test('per-phone lock after 10 failures across different student codes', async () => {
  for (let i = 0; i < 10; i++) {
    await guard.noteFailure(guard.keysFor({ phone: cred.phone, studentKey: `s${i}` }));
  }
  // pair keys differ each time (never reach 5), but the phone key accumulates to 10.
  const lock = await guard.checkLock(guard.keysFor({ phone: cred.phone, studentKey: 'sX' }));
  expect(lock.locked).toBe(true);
  expect(lock.which).toBe('phone');
});

test('per-student-code lock after 10 failures across different phones', async () => {
  for (let i = 0; i < 10; i++) {
    await guard.noteFailure(guard.keysFor({ phone: `08100000${i.toString().padStart(2, '0')}`, studentKey: '21199' }));
  }
  const lock = await guard.checkLock(guard.keysFor({ phone: '0899999999', studentKey: '21199' }));
  expect(lock.locked).toBe(true);
  expect(lock.which).toBe('student');
});

test('lock clears after the lock window elapses', async () => {
  const keys = guard.keysFor(cred);
  for (let i = 0; i < 5; i++) await guard.noteFailure(keys);
  expect((await guard.checkLock(keys)).locked).toBe(true);
  await guard.__advance(guard.POLICY.pair.lockMs + 1000);
  expect((await guard.checkLock(keys)).locked).toBe(false);
});

test('a success clears the pair failure counter', async () => {
  const keys = guard.keysFor(cred);
  for (let i = 0; i < 4; i++) await guard.noteFailure(keys);
  await guard.noteSuccess(keys);
  for (let i = 0; i < 4; i++) await guard.noteFailure(keys); // would be 8 without the clear
  expect((await guard.checkLock(keys)).locked).toBe(false);
});

test('a success clears only the pair, not the phone or student counters', async () => {
  // The old Map version deleted exactly one entry and this pins that it still
  // does. A correct credential says nothing about the other attempts seen
  // against that phone, so clearing them would hand an attacker a reset.
  const keys = guard.keysFor(cred);
  for (let i = 0; i < 4; i++) await guard.noteFailure(keys);
  await guard.noteSuccess(keys);
  const [rows] = await pool.query(
    'SELECT lock_type, attempt_count FROM line_bind_lockouts ORDER BY lock_type');
  const seen = rows.map((r) => `${r.lock_type}=${r.attempt_count}`).join(',');
  expect(seen).toBe('phone=4,student=4,sub=4');
});

test('hashed keys never contain the raw phone number', () => {
  const keys = guard.keysFor(cred);
  expect(JSON.stringify(keys)).not.toContain('0811112222');
  expect(JSON.stringify(keys)).not.toContain('21199');
});

test('the stored rows never contain the raw phone number either', async () => {
  // The Map version could only leak through its keys. A table can also leak
  // through a column, so this looks at what was actually written.
  await guard.noteFailure(guard.keysFor(cred));
  const [rows] = await pool.query('SELECT * FROM line_bind_lockouts');
  expect(`rows written: ${rows.length > 0}`).toBe('rows written: true');
  const dump = JSON.stringify(rows);
  expect(dump).not.toContain('0811112222');
  expect(dump).not.toContain('21199');
  expect(dump).not.toContain(cred.sub);
});

test('the count survives a process restart, which is the point of A1-9', async () => {
  // The Map version started from zero on every deploy, releasing every lockout
  // in force. Re-requiring the module with a cleared registry is the closest
  // this suite can get to a restart: a fresh module instance, same database.
  const keys = guard.keysFor(cred);
  for (let i = 0; i < 5; i++) await guard.noteFailure(keys);

  jest.resetModules();
  const reloaded = require('../src/services/lineBindGuard');
  expect(`same module instance: ${reloaded === guard}`).toBe('same module instance: false');
  expect((await reloaded.checkLock(reloaded.keysFor(cred))).locked).toBe(true);
});
