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
const { isVerificationUnavailable } = require('../utils/lineVerificationError');

const VERIFY_URL = 'https://api.line.me/oauth2/v2.1/verify';
let activeVerifications = 0;

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
  const maxConcurrent = env.line.idTokenVerifyMaxConcurrent || 20;
  if (activeVerifications >= maxConcurrent) {
    return { valid: false, error: 'verification_busy' };
  }

  const controller = new AbortController();
  const timeoutMs = env.line.idTokenVerifyTimeoutMs || 5000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timeout.unref === 'function') timeout.unref();
  activeVerifications += 1;
  try {
    const body = new URLSearchParams({ id_token: idToken, client_id: clientId });
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    const payload = await res.json().catch((err) => {
      // Malformed JSON stays invalid; body abort/network failures stay unavailable.
      if (err instanceof SyntaxError) return {};
      throw err;
    });
    if (!res.ok) {
      // LINE returns { error, error_description } for 4xx.
      // Token-redacted log: we log error code only, never the token itself.
      console.warn('[LINE_ID_TOKEN_VERIFY] rejected', {
        status: res.status,
        code:   payload.error || 'unknown',
      });
      if (res.status >= 500) return { valid: false, error: 'upstream_unavailable' };
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
    if (controller.signal.aborted) {
      console.warn('[LINE_ID_TOKEN_VERIFY] timeout', { timeoutMs });
      return { valid: false, error: 'timeout' };
    }
    console.error('[LINE_ID_TOKEN_VERIFY] network_error', { error: err.message });
    return { valid: false, error: 'network_error' };
  } finally {
    clearTimeout(timeout);
    activeVerifications -= 1;
  }
}

module.exports = { verifyIdToken, isVerificationUnavailable };
