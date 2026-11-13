import { useCallback, useEffect, useState } from 'react';
import api from '../api/axios';

// Roles that approve something (backend: GET /api/<role>/pending-summary).
export const PENDING_ROLES = ['school', 'affiliation', 'province', 'transport', 'admin'];

/**
 * Requests waiting for the signed-in role. `detail` adds item lists (dashboard
 * card); without it the response is counts only (bell, polled every minute).
 * Failures are silent: the badge is a convenience, never a blocker.
 */
export default function usePendingSummary(role, { detail = false, enabled = true, pollMs = 60_000 } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const active = enabled && PENDING_ROLES.includes(role);

  const load = useCallback(() => {
    if (!active) return Promise.resolve();
    setLoading(true);
    return api.get(`/${role}/pending-summary${detail ? '?detail=1' : ''}`)
      .then(r => setData(r.data?.data || null))
      .catch(() => { /* non-blocking */ })
      .finally(() => setLoading(false));
  }, [active, role, detail]);

  useEffect(() => {
    if (!active) { setData(null); return undefined; }
    load();
    if (!pollMs) return undefined;
    const id = setInterval(load, pollMs);
    return () => clearInterval(id);
  }, [active, load, pollMs]);

  return { data, loading, reload: load };
}
