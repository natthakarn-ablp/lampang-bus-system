import { useState, useCallback, createContext, useContext, useEffect } from 'react';
import { useAuth } from './useAuth';
import { readAdminScope, writeAdminScope } from '../utils/adminScope';

const AdminContext = createContext(null);

/**
 * Provides admin-selected scope context (schoolId, affiliationId).
 * Only meaningful for role=admin. Other roles ignore this entirely.
 * Persists the selection per browser (localStorage, see utils/adminScope) so
 * an admin does not have to pick the school / affiliation again every visit.
 */
export function AdminContextProvider({ children }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [schoolId, setSchoolIdRaw] = useState(() => (isAdmin ? readAdminScope('school') : ''));
  const [affiliationId, setAffiliationIdRaw] = useState(() => (isAdmin ? readAdminScope('affiliation') : ''));

  const setSchoolId = useCallback((id) => {
    setSchoolIdRaw(id ? String(id) : '');
    writeAdminScope('school', id);
  }, []);

  const setAffiliationId = useCallback((id) => {
    setAffiliationIdRaw(id ? String(id) : '');
    writeAdminScope('affiliation', id);
  }, []);

  // The auth user is re-hydrated after the first render, so isAdmin is still
  // false when the initial state above is computed. Load the remembered scope
  // once the admin is known; clear it from state when the user is not admin.
  useEffect(() => {
    if (isAdmin) {
      setSchoolIdRaw(readAdminScope('school'));
      setAffiliationIdRaw(readAdminScope('affiliation'));
    } else {
      setSchoolIdRaw('');
      setAffiliationIdRaw('');
    }
  }, [isAdmin]);

  return (
    <AdminContext.Provider value={{ isAdmin, schoolId, setSchoolId, affiliationId, setAffiliationId }}>
      {children}
    </AdminContext.Provider>
  );
}

export function useAdminContext() {
  const ctx = useContext(AdminContext);
  if (!ctx) return { isAdmin: false, schoolId: '', affiliationId: '', setSchoolId: () => {}, setAffiliationId: () => {} };
  return ctx;
}
