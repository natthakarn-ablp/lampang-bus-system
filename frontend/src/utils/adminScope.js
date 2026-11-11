/**
 * Admin scope (selected school / affiliation) persistence.
 *
 * An admin viewing /school or /affiliation pages picks which school or
 * affiliation to look at. The choice is remembered per browser in
 * localStorage so the admin does not have to pick again on every visit.
 * Every storage access is wrapped: private mode / blocked storage must never
 * break the page — it just falls back to "nothing selected".
 *
 * The stored id is only a hint: AdminScopeSelector validates it against the
 * list it loads and clears it when it is no longer valid. The backend still
 * enforces admin scope on every request.
 */

export const ADMIN_SCOPE_KEYS = {
  school: 'admin_school_id',
  affiliation: 'admin_affiliation_id',
};

/** Read the remembered id ('' when none). Falls back to the legacy per-tab sessionStorage value. */
export function readAdminScope(kind) {
  const key = ADMIN_SCOPE_KEYS[kind];
  if (!key) return '';
  try {
    const v = localStorage.getItem(key);
    if (v) return String(v);
  } catch { /* storage blocked */ }
  try {
    const v = sessionStorage.getItem(key);
    if (v) return String(v);
  } catch { /* storage blocked */ }
  return '';
}

/** Remember (or forget, when id is empty) the selected id. */
export function writeAdminScope(kind, id) {
  const key = ADMIN_SCOPE_KEYS[kind];
  if (!key) return;
  const value = id == null ? '' : String(id);
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* storage blocked */ }
  // localStorage is the source of truth; drop the legacy per-tab copy so it
  // can never resurrect an old choice.
  try { sessionStorage.removeItem(key); } catch { /* storage blocked */ }
}

/**
 * Snapshot of the remembered ids so a logout (which clears localStorage)
 * can put them back — the choice is per browser, not per login.
 */
export function snapshotAdminScopes() {
  return { school: readAdminScope('school'), affiliation: readAdminScope('affiliation') };
}

export function restoreAdminScopes(snapshot) {
  if (!snapshot) return;
  for (const kind of Object.keys(ADMIN_SCOPE_KEYS)) {
    if (snapshot[kind]) writeAdminScope(kind, snapshot[kind]);
  }
}

/** Return id when it appears in the loaded list, else ''. */
export function validAdminScope(id, list) {
  if (!id || !Array.isArray(list)) return '';
  return list.some(item => String(item?.id) === String(id)) ? String(id) : '';
}
