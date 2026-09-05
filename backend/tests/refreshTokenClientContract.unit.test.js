'use strict';

/**
 * The web client must keep the refresh token the server issues.
 *
 * /api/auth/refresh-token rotates: it revokes the token it was given and returns
 * a new one. The interceptor in frontend/src/api/axios.js stored only the access
 * token from that response and left refresh_token as the one just revoked — so
 * the NEXT refresh presented a token the server had revoked hours earlier.
 *
 * That was a latent bug with a small cost until this session. A revoked token
 * used to be a plain 401, and the interceptor's catch clears storage and sends
 * the user to /login: one re-login, on one device. Then replay detection landed
 * (A0-5). A refresh token presented long after it was revoked is now read as two
 * parties holding the same token — which is exactly what it looks like — and
 * ends every session for that account. The stale token is 24 hours old by then,
 * so the 10-second retry grace does not apply.
 *
 * In other words: adding replay detection turned a bug the residual-risk
 * register already describes (RR-02, "interceptor บันทึกเฉพาะ access_token")
 * into one every web user would hit on their second refresh. The server was
 * always returning the new token; it was only being dropped.
 *
 * WHY THIS IS A SOURCE ASSERTION
 * ------------------------------
 * The frontend has no test runner — no vitest, no jest, no *.test.jsx anywhere
 * under frontend/src. Rather than add a toolchain to assert one line, this reads
 * the interceptor the same way exportRateLimitCoverage reads the route files.
 * It is a weaker test than executing it, and it is honest about which line it is
 * pinning.
 */

const fs = require('fs');
const path = require('path');

const AXIOS_CLIENT = path.join(__dirname, '..', '..', 'frontend', 'src', 'api', 'axios.js');
const source = fs.readFileSync(AXIOS_CLIENT, 'utf8');

/** The refresh handler, from the POST to the end of its try block. */
function refreshBlock() {
  const start = source.indexOf("axios.post('/api/auth/refresh-token'");
  expect(`found the refresh call: ${start !== -1}`).toBe('found the refresh call: true');
  const end = source.indexOf('} catch (refreshErr)', start);
  expect(`found the end of the block: ${end !== -1}`).toBe('found the end of the block: true');
  return source.slice(start, end);
}

describe('frontend refresh interceptor', () => {
  it('stores the rotated refresh token, not just the access token', () => {
    const block = refreshBlock();
    expect(`reads refresh_token from the response: ${/data\.refresh_token/.test(block)}`)
      .toBe('reads refresh_token from the response: true');
    expect(`writes it back to storage: ${/setItem\(\s*'refresh_token'/.test(block)}`)
      .toBe('writes it back to storage: true');
  });

  it('still stores the new access token', () => {
    // The line that was already there. Asserted so a future edit cannot fix one
    // half by removing the other.
    const block = refreshBlock();
    expect(`writes access_token: ${/setItem\(\s*'access_token'/.test(block)}`)
      .toBe('writes access_token: true');
  });

  it('sends the stored refresh token, so the two halves are the same slot', () => {
    const block = refreshBlock();
    expect(`sends getItem('refresh_token'): ${/getItem\(\s*'refresh_token'\s*\)/.test(block)}`)
      .toBe("sends getItem('refresh_token'): true");
  });

  it('login is no longer the only place a refresh token is written', () => {
    // Before the fix, useAuth.jsx was the sole writer — which is what made the
    // stored token go stale after the first rotation.
    const writers = [];
    const frontendSrc = path.join(__dirname, '..', '..', 'frontend', 'src');
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(js|jsx)$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          if (/setItem\(\s*'refresh_token'/.test(text)) writers.push(path.relative(frontendSrc, full).replace(/\\/g, '/'));
        }
      }
    };
    walk(frontendSrc);
    expect(`writers: ${writers.sort().join(', ')}`).toBe('writers: api/axios.js, hooks/useAuth.jsx');
  });
});
