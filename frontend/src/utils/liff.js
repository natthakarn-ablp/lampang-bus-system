/**
 * LIFF helper — resolves LINE user ID from LIFF SDK or URL fallback.
 *
 * Resolution order:
 * 1. LIFF SDK (if liffId is configured and running inside LINE app)
 * 2. URL query param ?line_user_id=Uxxx (dev/fallback)
 *
 * Usage:
 *   const lineUserId = await resolveLineUserId();
 *
 * LIFF_ID config:
 *   Set VITE_LIFF_ID in frontend .env or env vars.
 *   If not set, LIFF SDK is skipped entirely (query param only).
 */

const LIFF_ID = import.meta.env.VITE_LIFF_ID || '';

let _liffReady = false;
let _cachedUserId = null;
let _liffModule = null;

async function getLiffModule() {
  if (_liffModule) return _liffModule;
  if (!LIFF_ID) return null;
  _liffModule = (await import('@line/liff')).default;
  if (!_liffReady) {
    await _liffModule.init({ liffId: LIFF_ID });
    _liffReady = true;
  }
  return _liffModule;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.loginOutsideLine=true] When false and the page is
 *   open in an ordinary browser (liff.isInClient() === false), do NOT call
 *   the LIFF login call. Logging in outside LINE jumps to LINE's email/password
 *   page with no explanation (live QA parent-01); parent pages pass false and
 *   show their own "open in LINE" screen instead. The admin LINE-verification
 *   flow keeps the default because admins verify from a desktop browser.
 */
export async function resolveLineUserId({ loginOutsideLine = true } = {}) {
  // Return cached result if already resolved
  if (_cachedUserId) return _cachedUserId;

  // Try LIFF SDK if configured
  if (LIFF_ID) {
    try {
      const liff = await getLiffModule();

      if (liff.isLoggedIn()) {
        const profile = await liff.getProfile();
        _cachedUserId = profile.userId;
        return _cachedUserId;
      } else if (!loginOutsideLine && !safeIsInClient(liff)) {
        // Ordinary browser and the caller asked not to bounce to LINE login.
        return '';
      } else {
        // Not logged in — trigger login and come BACK to this page.
        //
        // Without redirectUri, LIFF returns the user to the LIFF app's
        // Endpoint URL, which for this project sits under /parent/link. An
        // admin who started LINE verification on /parent/link/admin-recovery
        // therefore landed on the PARENT binding page and could never obtain
        // an id token, so "ผูกบัญชี LINE" stayed disabled forever
        // (AdminAccountSecurity.jsx disables it while lineIdToken is empty).
        // window.location.href is always under the endpoint path, which is
        // what LIFF requires of a redirect target.
        liff.login({ redirectUri: window.location.href });
        return ''; // Will redirect, so this won't render
      }
    } catch (err) {
      console.warn('[liff] LIFF init failed, falling back to query param:', err.message);
    }
  }

  // Fallback: URL query param
  const params = new URLSearchParams(window.location.search);
  _cachedUserId = params.get('line_user_id') || '';
  return _cachedUserId;
}

/**
 * Phase 10.3E-UX1 — return the LIFF ID token. Backend uses this token via
 * LINE Verify API to confirm the LINE userId is genuine. Sensitive ops
 * (bind / unlink) require it; passive ops (status view) may skip it.
 *
 * Returns '' when:
 *   • LIFF SDK not configured (no VITE_LIFF_ID)
 *   • Not running inside LINE / LIFF browser
 *   • User not logged in (caller should resolveLineUserId() first to trigger login)
 */
export async function getLiffIdToken() {
  if (!LIFF_ID) return '';
  try {
    const liff = await getLiffModule();
    if (!liff.isLoggedIn()) return '';
    return liff.getIDToken() || '';
  } catch (err) {
    console.warn('[liff] getIDToken failed:', err.message);
    return '';
  }
}

export function isLiffReady() {
  return _liffReady;
}

function safeIsInClient(liff) {
  try { return !!liff?.isInClient(); } catch { return false; }
}

// Public add-friend link of the system's LINE OA.
export const LINE_OA_ID = '@943glwjf';
export const LINE_OA_URL = 'https://line.me/R/ti/p/@943glwjf';

/**
 * URL that opens a LIFF page inside the LINE app. `subPath` is relative to the
 * LIFF Endpoint URL (/parent), e.g. '/link' for /parent/link. Without a
 * configured LIFF ID the LINE OA add-friend link is returned instead.
 */
export function getLiffLaunchUrl(subPath = '') {
  if (!LIFF_ID) return LINE_OA_URL;
  return `https://liff.line.me/${LIFF_ID}${subPath}`;
}

/** Start LINE login in this (external) browser — explicit user choice only. */
export async function loginWithLineHere() {
  const liff = await getLiffModule();
  if (!liff) return;
  liff.login({ redirectUri: window.location.href });
}

/**
 * True only when LIFF is configured and initialised and the page is NOT in the
 * LINE client — i.e. a real LIFF deployment opened in Chrome/Facebook/desktop.
 * Without VITE_LIFF_ID (local dev, CI captures) this is false, so those keep
 * the legacy screens.
 */
export function isOutsideLineClient() {
  if (!LIFF_ID || !_liffReady || !_liffModule) return false;
  return !safeIsInClient(_liffModule);
}

export function isInLiffClient() {
  // Hint for UI: true if we're running inside the LINE client (LIFF browser)
  // and can rely on idToken; false if we're in a regular desktop browser.
  if (!_liffReady || !_liffModule) return false;
  try { return _liffModule.isInClient(); } catch { return false; }
}
