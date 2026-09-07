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

export async function resolveLineUserId() {
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

export function isInLiffClient() {
  // Hint for UI: true if we're running inside the LINE client (LIFF browser)
  // and can rely on idToken; false if we're in a regular desktop browser.
  if (!_liffReady || !_liffModule) return false;
  try { return _liffModule.isInClient(); } catch { return false; }
}
