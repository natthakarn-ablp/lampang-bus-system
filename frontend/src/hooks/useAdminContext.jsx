import { useState, useCallback, createContext, useContext, useEffect } from 'react';
import { useAuth } from './useAuth';

const AdminContext = createContext(null);

/**
 * Provides admin-selected scope context (schoolId, affiliationId).
 * Only meaningful for role=admin. Other roles ignore this entirely.
 * Persists selection in sessionStorage so refresh keeps context.
 */
export function AdminContextProvider({ children }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [schoolId, setSchoolIdRaw] = useState(() =>
    isAdmin ? sessionStorage.getItem('admin_school_id') || '' : ''
  );
  const [affiliationId, setAffiliationIdRaw] = useState(() =>
    isAdmin ? sessionStorage.getItem('admin_affiliation_id') || '' : ''
  );

  const setSchoolId = useCallback((id) => {
    setSchoolIdRaw(id);
    if (id) sessionStorage.setItem('admin_school_id', id);
    else sessionStorage.removeItem('admin_school_id');
  }, []);

  const setAffiliationId = useCallback((id) => {
    setAffiliationIdRaw(id);
    if (id) sessionStorage.setItem('admin_affiliation_id', id);
    else sessionStorage.removeItem('admin_affiliation_id');
  }, []);

  // Clear context if user logs out or changes
  useEffect(() => {
    if (!isAdmin) {
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
