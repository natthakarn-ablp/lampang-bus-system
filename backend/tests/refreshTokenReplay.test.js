'use strict';

/**
 * A0-5 — refresh-token replay detection.
 *
 * Rotation was already in place: /refresh-token revokes the token it was given
 * and issues a new one, so a stolen token is good for one use. What was missing
 * is what happens when the loser of that race shows up.
 *
 * Before this change, presenting an already-rotated refresh token returned 401
 * and nothing else. Whoever refreshed first — attacker or victim — kept a valid
 * token and went on rotating it. These tests assert the other half: the account's
 * whole session ends, the winner's token is dead too, and the access token that
 * had 24h left stops working.
 *
 * The grace window is exercised by rewriting revoked_at in the database rather
 * than by sleeping, so the suite does not spend ten seconds proving a constant.
 */

require('dotenv').config();
const request = require('supertest');

const app = require('../src/app');
const { pool } = require('../src/config/database');
const { sessionResetJti } = require('../src/utils/sessionReset');

const USER = { username: '__test_province', password: 'testpass123' };

let userId = null;

async function login() {
  const res = await request(app).post('/api/auth/login').send(USER);
  expect(`login -> ${res.status}`).toBe('login -> 200');
  return { access: res.body.data.access_token, refresh: res.body.data.refresh_token };
}

const refresh = (token) => request(app).post('/api/auth/refresh-token').send({ refresh_token: token });
const me = (token) => request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

/** Age the revocation row so the request lands outside REPLAY_GRACE_MS. */
async function ageRevocation(jti, seconds) {
  const [r] = await pool.query(
    'UPDATE revoked_tokens SET revoked_at = DATE_SUB(NOW(), INTERVAL ? SECOND) WHERE jti = ?',
    [seconds, jti]
  );
  expect(`aged ${jti}: ${r.affectedRows}`).toBe(`aged ${jti}: 1`);
}

function jtiOf(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).jti;
}

beforeAll(async () => {
  const [[row]] = await pool.query('SELECT id FROM users WHERE username = ? LIMIT 1', [USER.username]);
  userId = row.id;
});

// Every test starts from a clean slate: the sentinel is per-user and would
// otherwise make a later test read a cutoff an earlier one wrote.
beforeEach(async () => {
  await pool.query('DELETE FROM revoked_tokens WHERE user_id = ?', [userId]);
});

afterAll(async () => {
  await pool.query('DELETE FROM revoked_tokens WHERE user_id = ?', [userId]);
});

describe('A0-5 — replaying a rotated refresh token ends every session', () => {
  it('rotates on a normal refresh: the old token dies, the new one works', async () => {
    const { refresh: r1 } = await login();

    const first = await refresh(r1);
    expect(`rotate -> ${first.status}`).toBe('rotate -> 200');
    const r2 = first.body.data.refresh_token;
    expect(`r2 differs from r1: ${r2 !== r1}`).toBe('r2 differs from r1: true');

    const second = await refresh(r2);
    expect(`r2 usable -> ${second.status}`).toBe('r2 usable -> 200');
  });

  it('treats a re-presented token inside the grace window as a client retry', async () => {
    const { refresh: r1 } = await login();
    const rotated = await refresh(r1);
    expect(rotated.status).toBe(200);
    const r2 = rotated.body.data.refresh_token;

    // No ageing: revoked_at is a moment ago, which is what a lost-response retry
    // looks like. This must NOT end the account's sessions.
    const retry = await refresh(r1);
    expect(`retry -> ${retry.status} ${retry.body.errors?.[0]?.code}`)
      .toBe('retry -> 401 REFRESH_TOKEN_REVOKED');

    const [reset] = await pool.query('SELECT jti FROM revoked_tokens WHERE jti = ?', [sessionResetJti(userId)]);
    expect(`session reset written: ${reset.length > 0}`).toBe('session reset written: false');

    const still = await refresh(r2);
    expect(`r2 still usable -> ${still.status}`).toBe('r2 still usable -> 200');
  });

  it('past the grace window, kills the winner of the race as well', async () => {
    const { refresh: r1 } = await login();
    const rotated = await refresh(r1);
    expect(rotated.status).toBe(200);
    const r2 = rotated.body.data.refresh_token;
    const a2 = rotated.body.data.access_token;

    // r2 is the token the other party is holding — the one rotation alone would
    // have left valid forever.
    expect((await refresh(r2)).status).toBe(200);

    await ageRevocation(jtiOf(r1), 60);
    const replay = await refresh(r1);
    expect(`replay -> ${replay.status} ${replay.body.errors?.[0]?.code}`)
      .toBe('replay -> 401 REFRESH_TOKEN_REPLAY');

    // The point of the whole feature.
    const winner = await refresh(r2);
    expect(`winner's refresh after detection -> ${winner.status} ${winner.body.errors?.[0]?.code}`)
      .toBe("winner's refresh after detection -> 401 SESSION_REVOKED");

    // And the access token it already holds, which had ~24h left.
    const winnerAccess = await me(a2);
    expect(`winner's access token -> ${winnerAccess.status} ${winnerAccess.body.errors?.[0]?.code}`)
      .toBe("winner's access token -> 401 SESSION_REVOKED");
  });

  it('kills sessions the replayed token never belonged to', async () => {
    // A second device, logged in independently. Its tokens share nothing with
    // the replayed chain except the account, and that is the point: the account
    // is what is compromised.
    const other = await login();
    expect((await me(other.access)).status).toBe(200);

    const { refresh: r1 } = await login();
    const rotated = await refresh(r1);
    expect(rotated.status).toBe(200);

    await ageRevocation(jtiOf(r1), 60);
    expect((await refresh(r1)).status).toBe(401);

    const otherAfter = await me(other.access);
    expect(`other device -> ${otherAfter.status} ${otherAfter.body.errors?.[0]?.code}`)
      .toBe('other device -> 401 SESSION_REVOKED');
  });

  it('lets the user back in after re-authenticating', async () => {
    const { refresh: r1 } = await login();
    const rotated = await refresh(r1);
    expect(rotated.status).toBe(200);
    await ageRevocation(jtiOf(r1), 60);
    expect((await refresh(r1)).status).toBe(401);

    // The cutoff has one-second resolution and the rule is `iat <= cutoff`, so a
    // login in the same second as the reset is deliberately rejected too. Age
    // the sentinel by a second to test the case that matters: the user logging
    // in afterwards must get a working session, not a permanent lockout.
    await ageRevocation(sessionResetJti(userId), 1);

    const fresh = await login();
    const check = await me(fresh.access);
    expect(`fresh session -> ${check.status}`).toBe('fresh session -> 200');
    expect((await refresh(fresh.refresh)).status).toBe(200);
  });

  it('writes an audit row naming the replay', async () => {
    const { refresh: r1 } = await login();
    const rotated = await refresh(r1);
    expect(rotated.status).toBe(200);
    await ageRevocation(jtiOf(r1), 60);
    await refresh(r1);

    const [rows] = await pool.query(
      `SELECT action, entity_type FROM audit_logs
        WHERE entity_type = 'refresh_token_replay' AND entity_id = ?
        ORDER BY id DESC LIMIT 1`,
      [String(userId)]
    );
    expect(`audit rows: ${rows.length}`).toBe('audit rows: 1');
    expect(`${rows[0].action}/${rows[0].entity_type}`).toBe('LOGIN/refresh_token_replay');
  });
});
