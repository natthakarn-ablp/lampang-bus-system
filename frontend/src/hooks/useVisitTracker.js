import { useEffect } from 'react';
import { useAuth } from './useAuth';

/**
 * useVisitTracker — fires one POST /api/visits/track per browser tab session.
 *
 * - Dedupes via sessionStorage (one hit per tab).
 * - Waits for AuthProvider to finish loading so we can label the visit
 *   correctly as public or logged-in.
 * - Uses raw fetch (not the api axios instance) to avoid the auth refresh
 *   interceptor being involved in a public, fire-and-forget call.
 * - Failures are silently swallowed — visit tracking must never break the UX.
 */

const SESSION_KEY = 'visit_tracked_v1';

export function useVisitTracker() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    try {
      if (sessionStorage.getItem(SESSION_KEY) === '1') return;
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // sessionStorage unavailable (private mode, etc.) — skip dedupe and still try once
    }

    const payload = JSON.stringify({ logged_in: !!user });
    fetch('/api/visits/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => { /* never break UX on tracking failure */ });
  }, [loading, user]);
}
