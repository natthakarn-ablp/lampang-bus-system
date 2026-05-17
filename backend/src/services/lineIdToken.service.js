'use strict';

/**
 * lineIdToken.service.js — Phase 10.3E-UX1
 *
 * Verifies LIFF-issued ID tokens via LINE's public verify endpoint.
 *
 *   https://developers.line.biz/en/reference/line-login/#verify-id-token
 *
 * Why server-side verify?
 * The LIFF SDK in the browser hands us a JWT (idToken) plus a profile.userId.
 * Either can be spoofed by a malicious page or a forged request, so the
 * backend must POST the idToken to LINE and use the LINE-returned `sub`
 * field as the canonical user id. We NEVER trust `line_user_id` from the
 * request body for sensitive operations (bind / unlink).
 *
 * Response from LINE Verify on success:
 *   { iss, sub, aud, exp, iat, nonce?, amr?, name?, picture? }
 * The `aud` field equals the LIFF login channel id (the part before the
 * dash in LIFF_ID, e.g. "2009055277" for "2009055277-UFhJvGve").
 */

const env = require('../config/env');

const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';

// Channel id is the first segment of LIFF_ID (channel-id-dash-liff-id).
function getLiffChannelId() {
  const id = env.line.liffId || '';
  const dash = id.indexOf('-');
  return dash > 0 ? id.slice(0, dash) : '';
}

/**
 * Verify a LIFF ID token. Returns { valid, userId, payload, error }.
 * Never throws — caller decides how to handle invalid tokens.
 *
 * @param {string} idToken  - JWT from liff.getIDToken()
 * @returns {Promise<{valid: boolean, userId?: string, payload?: object, error?: string}>}
 */
async function verifyIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    return { valid: false, error: 'missing_token' };
  }
  const clientId = getLiffChannelId();
  if (!clientId) {
    return { valid: false, error: 'liff_channel_not_configured' };
  }
  try {
    const body = new URLSearchParams({ id_token: idToken, client_id: clientId });
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      // LINE returns { error, error_description } for 4xx.
      // Token-redacted log: we log error code only, never the token itself.
      console.warn('[LINE_ID_TOKEN_VERIFY] rejected', {
        status: res.status,
        code:   payload.error || 'unknown',
      });
      return { valid: false, error: payload.error || `http_${res.status}` };
    }
    if (!payload.sub) {
      return { valid: false, error: 'no_sub_in_payload' };
    }
    // Defence in depth: confirm `aud` matches our channel id.
    if (payload.aud && payload.aud !== clientId) {
      console.warn('[LINE_ID_TOKEN_VERIFY] aud_mismatch', { expected: clientId, got: payload.aud });
      return { valid: false, error: 'aud_mismatch' };
    }
    return { valid: true, userId: payload.sub, payload };
  } catch (err) {
    console.error('[LINE_ID_TOKEN_VERIFY] network_error', { error: err.message });
    return { valid: false, error: 'network_error' };
  }
}

module.exports = { verifyIdToken };
