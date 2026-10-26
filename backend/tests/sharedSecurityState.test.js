'use strict';

/**
 * A1-9 — the counters that refuse a request now live where every instance can
 * see them.
 *
 * WHAT WAS WRONG
 * --------------
 * Two `Map`s inside one Node process decided security outcomes:
 *
 *   auth.routes.js:36   LOGIN_FAILS  10 failures per (username+IP) in 15 min
 *   line.routes.js:50   SEEN_EVENTS  a 5,000-entry ring of handled LINE events
 *
 * The comment above LOGIN_FAILS named the condition itself — single instance
 * (pm2 fork), move this before running more than one. Two consequences it does
 * not spell out:
 *
 *   - With N instances each enforcing its own ceiling, an attacker who can
 *     reach all of them gets 10N attempts against one account while every
 *     instance believes it is enforcing 10.
 *   - A restart empties the Map, so a deploy released every lockout in force.
 *     That is a single-instance problem too.
 *
 * SEEN_EVENTS had its own single-instance failure: an event older than the last
 * 5,000 falls out of the ring, LINE redelivers on timeout, and the redelivery is
 * processed a second time — a duplicate notification and a duplicate row.
 *
 * WHAT THIS TEST PROVES
 * ---------------------
 * The threshold and window are unchanged, the state survives a restart, and the
 * webhook claim is decided by the database rather than by whichever process
 * happened to answer.
 */

require('dotenv').config();
const state = require('../src/utils/sharedSecurityState');
const { pool } = require('../src/config/database');

const USERNAME = '__a19_probe_user';
const IP = '203.0.113.7';
const KEY = state.loginLockKey(USERNAME, IP);

/** Age every login row by `sec`, since the window is judged by MySQL's NOW(). */
async function ageLoginRows(sec) {
  await pool.query(
    'UPDATE login_lockouts SET window_start = DATE_SUB(window_start, INTERVAL ? SECOND) WHERE key_hash = ?',
    [sec, KEY]
  );
}

// Only the rows this file writes. teardown.js clears these tables wholesale
// between suites; a test that did the same mid-run would be deleting another
// suite's state rather than its own.
async function clearOwnRows() {
  await pool.query('DELETE FROM login_lockouts WHERE key_hash = ?', [KEY]);
  await pool.query("DELETE FROM line_webhook_events_seen WHERE event_id LIKE '__a19%'");
}

beforeEach(clearOwnRows);
afterAll(clearOwnRows);

describe('the login lockout key', () => {
  it('is a hash, not the username and IP', () => {
    expect(KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(KEY).not.toContain(USERNAME);
    expect(KEY).not.toContain(IP);
  });

  it('normalises case and surrounding space, so those cannot buy a fresh budget', () => {
    expect(state.loginLockKey('  ADMIN  ', IP)).toBe(state.loginLockKey('admin', IP));
  });

  it('separates different IPs and different users', () => {
    expect(state.loginLockKey('admin', '10.0.0.1')).not.toBe(state.loginLockKey('admin', '10.0.0.2'));
    expect(state.loginLockKey('admin', IP)).not.toBe(state.loginLockKey('admin2', IP));
  });

  it('cannot be confused by a username containing the separator', () => {
    // 'a|b' with ip 'c' and 'a' with ip 'b|c' must not collide.
    expect(state.loginLockKey('a|b', 'c')).not.toBe(state.loginLockKey('a', 'b|c'));
  });
});

describe('the login lockout counts and locks', () => {
  it('is not locked before the threshold', async () => {
    for (let i = 1; i < state.LOGIN_LOCK.THRESHOLD; i++) {
      await state.noteLoginFail(KEY);
      expect(`after ${i}: ${await state.isLoginLocked(KEY)}`).toBe(`after ${i}: false`);
    }
  });

  it('locks exactly at the threshold', async () => {
    for (let i = 0; i < state.LOGIN_LOCK.THRESHOLD; i++) await state.noteLoginFail(KEY);
    expect(await state.isLoginLocked(KEY)).toBe(true);
  });

  it('a success clears the count', async () => {
    for (let i = 0; i < state.LOGIN_LOCK.THRESHOLD; i++) await state.noteLoginFail(KEY);
    await state.clearLoginFails(KEY);
    expect(await state.isLoginLocked(KEY)).toBe(false);
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM login_lockouts WHERE key_hash = ?', [KEY]);
    expect(`rows left: ${rows[0].n}`).toBe('rows left: 0');
  });

  it('the lock lapses once the window has passed', async () => {
    for (let i = 0; i < state.LOGIN_LOCK.THRESHOLD; i++) await state.noteLoginFail(KEY);
    expect(await state.isLoginLocked(KEY)).toBe(true);
    await ageLoginRows(state.LOGIN_LOCK.WINDOW_SEC + 5);
    expect(await state.isLoginLocked(KEY)).toBe(false);
  });

  it('a failure after the window starts a fresh count, not a resumed one', async () => {
    // 9 failures, wait out the window, then one more. That is 1, not 10 — the
    // Map version reset the same way and this pins it against an upsert that
    // forgot the reset branch.
    for (let i = 0; i < state.LOGIN_LOCK.THRESHOLD - 1; i++) await state.noteLoginFail(KEY);
    await ageLoginRows(state.LOGIN_LOCK.WINDOW_SEC + 5);
    await state.noteLoginFail(KEY);
    const [rows] = await pool.query('SELECT fail_count FROM login_lockouts WHERE key_hash = ?', [KEY]);
    expect(`count: ${rows[0].fail_count}`).toBe('count: 1');
    expect(await state.isLoginLocked(KEY)).toBe(false);
  });

  it('does not lock a different key', async () => {
    for (let i = 0; i < state.LOGIN_LOCK.THRESHOLD; i++) await state.noteLoginFail(KEY);
    expect(await state.isLoginLocked(state.loginLockKey('someone_else', IP))).toBe(false);
  });

  it('survives a restart — the reason A1-9 exists', async () => {
    for (let i = 0; i < state.LOGIN_LOCK.THRESHOLD; i++) await state.noteLoginFail(KEY);
    jest.resetModules();
    const reloaded = require('../src/utils/sharedSecurityState');
    expect(`same instance: ${reloaded === state}`).toBe('same instance: false');
    expect(await reloaded.isLoginLocked(reloaded.loginLockKey(USERNAME, IP))).toBe(true);
  });

  it('concurrent failures all count — no lost update', async () => {
    // The Map version read, decided and wrote in three steps. Ten simultaneous
    // failures against one key must land as ten, not as some smaller number
    // because several readers saw the same value.
    await Promise.all(
      Array.from({ length: state.LOGIN_LOCK.THRESHOLD }, () => state.noteLoginFail(KEY))
    );
    const [rows] = await pool.query('SELECT fail_count FROM login_lockouts WHERE key_hash = ?', [KEY]);
    expect(`count: ${rows[0].fail_count}`).toBe(`count: ${state.LOGIN_LOCK.THRESHOLD}`);
    expect(await state.isLoginLocked(KEY)).toBe(true);
  });
});

describe('the LINE webhook claim', () => {
  it('reports the first sighting as new and the second as already handled', async () => {
    const id = '__a19_evt_1';
    expect(await state.alreadyProcessed(id)).toBe(false);
    expect(await state.alreadyProcessed(id)).toBe(true);
    expect(await state.alreadyProcessed(id)).toBe(true);
  });

  it('keeps different events apart', async () => {
    expect(await state.alreadyProcessed('__a19_evt_a')).toBe(false);
    expect(await state.alreadyProcessed('__a19_evt_b')).toBe(false);
  });

  it('gives exactly one of many concurrent claims the event', async () => {
    // This is what the Map could not do across processes: with two instances
    // both would insert into their own copy and both would handle the event.
    const id = '__a19_evt_race';
    const results = await Promise.all(
      Array.from({ length: 8 }, () => state.alreadyProcessed(id))
    );
    const firstSightings = results.filter((seen) => seen === false).length;
    expect(`claimed by: ${firstSightings}`).toBe('claimed by: 1');
  });

  it('survives a restart, so a late redelivery is still recognised', async () => {
    // The 5,000-entry ring lost old ids even on one instance, and a restart
    // lost all of them. LINE redelivers on timeout.
    const id = '__a19_evt_restart';
    expect(await state.alreadyProcessed(id)).toBe(false);
    jest.resetModules();
    const reloaded = require('../src/utils/sharedSecurityState');
    expect(await reloaded.alreadyProcessed(id)).toBe(true);
  });

  it('treats a missing event id as new rather than colliding on an empty key', async () => {
    // LINE always sends one; an absent id means a malformed body. Handling such
    // an event once is better than having every malformed event share a key and
    // silence the rest.
    expect(await state.alreadyProcessed(undefined)).toBe(false);
    expect(await state.alreadyProcessed('')).toBe(false);
    expect(await state.alreadyProcessed(null)).toBe(false);
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS n FROM line_webhook_events_seen WHERE event_id = ''");
    expect(`empty-key rows: ${rows[0].n}`).toBe('empty-key rows: 0');
  });
});

describe('the source of truth is the table, not a Map', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8');

  it('auth.routes.js no longer holds LOGIN_FAILS', () => {
    const src = read('routes/auth.routes.js');
    expect(`LOGIN_FAILS present: ${/LOGIN_FAILS/.test(src)}`).toBe('LOGIN_FAILS present: false');
    expect(`imports the shared module: ${/sharedSecurityState/.test(src)}`)
      .toBe('imports the shared module: true');
  });

  it('line.routes.js no longer holds SEEN_EVENTS', () => {
    const src = read('routes/line.routes.js');
    expect(`SEEN_EVENTS present: ${/SEEN_EVENTS/.test(src)}`).toBe('SEEN_EVENTS present: false');
    expect(`imports the shared module: ${/sharedSecurityState/.test(src)}`)
      .toBe('imports the shared module: true');
  });

  it('lineBindGuard.js no longer holds its counters Map', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'lineBindGuard.js'), 'utf8');
    expect(`counters Map present: ${/const counters = new Map\(\)/.test(src)}`)
      .toBe('counters Map present: false');
  });

  it('the linking session is still in memory, and says why', () => {
    // Not an oversight. line_link_sessions would store a phone number in
    // readable form and the DDL proposal makes that a DPO decision under D0-8,
    // which has not been made. Asserted so removing the explanation is a test
    // failure rather than a silent loss of the reason.
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'line.service.js'), 'utf8');
    expect(`linkingState still a Map: ${/linkingState = new Map\(\)/.test(src)}`)
      .toBe('linkingState still a Map: true');
    const shared = read('utils/sharedSecurityState.js');
    expect(`D0-8 named in the shared module: ${/D0-8/.test(shared)}`)
      .toBe('D0-8 named in the shared module: true');
  });
});
