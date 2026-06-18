'use strict';

/**
 * lineBindGuard.test.js — Phase 10.13C-4A
 *
 * Pure unit tests for the credential-level lockout. No DB, no network, no app —
 * run with an isolated jest config (no globalSetup), e.g.:
 *   npx jest --config '{"testEnvironment":"node"}' --testPathPattern lineBind --runInBand
 *
 * Proves a brute-force is locked by the CREDENTIAL (phone / student / pair / sub),
 * so rotating the source IP does not help, and that keys never hold the raw phone.
 */

const guard = require('../src/services/lineBindGuard');

let clock;
beforeEach(() => { clock = 1_000_000; guard.__setClock(() => clock); guard.__reset(); guard.__setClock(() => clock); });
afterAll(() => guard.__reset());

const cred = { phone: '0811112222', studentKey: '21199', sub: 'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01' };

test('pair locks after 5 failures (POLICY.pair.max)', () => {
  const keys = guard.keysFor(cred);
  for (let i = 0; i < 4; i++) { guard.noteFailure(keys); expect(guard.checkLock(keys).locked).toBe(false); }
  guard.noteFailure(keys); // 5th
  const lock = guard.checkLock(keys);
  expect(lock.locked).toBe(true);
  expect(lock.which).toBe('pair');
  expect(lock.reason).toBe('LOCKED_PAIR');
});

test('rotating IP cannot bypass — lock is keyed on the credential, not the request', () => {
  const keys = guard.keysFor(cred);
  for (let i = 0; i < 5; i++) guard.noteFailure(keys);
  // A "new IP" recomputes the SAME hashed credential keys → still locked.
  const sameCredFreshKeys = guard.keysFor({ phone: cred.phone, studentKey: cred.studentKey });
  expect(guard.checkLock(sameCredFreshKeys).locked).toBe(true);
});

test('per-phone lock after 10 failures across different student codes', () => {
  for (let i = 0; i < 10; i++) {
    guard.noteFailure(guard.keysFor({ phone: cred.phone, studentKey: `s${i}` }));
  }
  // pair keys differ each time (never reach 5), but the phone key accumulates to 10.
  const lock = guard.checkLock(guard.keysFor({ phone: cred.phone, studentKey: 'sX' }));
  expect(lock.locked).toBe(true);
  expect(lock.which).toBe('phone');
});

test('per-student-code lock after 10 failures across different phones', () => {
  for (let i = 0; i < 10; i++) {
    guard.noteFailure(guard.keysFor({ phone: `08100000${i.toString().padStart(2, '0')}`, studentKey: '21199' }));
  }
  const lock = guard.checkLock(guard.keysFor({ phone: '0899999999', studentKey: '21199' }));
  expect(lock.locked).toBe(true);
  expect(lock.which).toBe('student');
});

test('lock clears after the lock window elapses', () => {
  const keys = guard.keysFor(cred);
  for (let i = 0; i < 5; i++) guard.noteFailure(keys);
  expect(guard.checkLock(keys).locked).toBe(true);
  clock += guard.POLICY.pair.lockMs + 1000;
  expect(guard.checkLock(keys).locked).toBe(false);
});

test('a success clears the pair failure counter', () => {
  const keys = guard.keysFor(cred);
  for (let i = 0; i < 4; i++) guard.noteFailure(keys);
  guard.noteSuccess(keys);
  for (let i = 0; i < 4; i++) guard.noteFailure(keys); // would be 8 without the clear
  expect(guard.checkLock(keys).locked).toBe(false);
});

test('hashed keys never contain the raw phone number', () => {
  const keys = guard.keysFor(cred);
  expect(JSON.stringify(keys)).not.toContain('0811112222');
  expect(JSON.stringify(keys)).not.toContain('21199');
});
