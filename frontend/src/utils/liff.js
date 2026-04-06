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

export async function resolveLineUserId() {
  // Return cached result if already resolved
  if (_cachedUserId) return _cachedUserId;

  // Try LIFF SDK if configured
  if (LIFF_ID) {
    try {
      const liff = (await import('@line/liff')).default;
      await liff.init({ liffId: LIFF_ID });
      _liffReady = true;

      if (liff.isLoggedIn()) {
        const profile = await liff.getProfile();
        _cachedUserId = profile.userId;
        return _cachedUserId;
      } else {
        // In LIFF browser but not logged in — trigger login
        liff.login();
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

export function isLiffReady() {
  return _liffReady;
}
