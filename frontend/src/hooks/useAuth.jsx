import { useState, useCallback, useEffect, createContext, useContext } from 'react';
import api from '../api/axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [features, setFeatures] = useState(null);
  const [loading, setLoading] = useState(true);

  // Re-hydrate from localStorage on first mount
  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch { /* ignore */ }
    }
    // Phase 11A audit fix M7: re-hydrate feature flags so sidebar links
    // are hidden/shown correctly after a page refresh.
    const storedFeatures = localStorage.getItem('features');
    if (storedFeatures) {
      try { setFeatures(JSON.parse(storedFeatures)); } catch { /* ignore */ }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    const { access_token, refresh_token, user: userData, features: featureFlags } = res.data.data;

    localStorage.setItem('access_token',  access_token);
    localStorage.setItem('refresh_token', refresh_token);
    localStorage.setItem('user', JSON.stringify(userData));
    if (featureFlags) {
      localStorage.setItem('features', JSON.stringify(featureFlags));
      setFeatures(featureFlags);
    }
    setUser(userData);

    return userData;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {
        refresh_token: localStorage.getItem('refresh_token'),
      });
    } catch { /* ignore network errors on logout */ }
    localStorage.clear();
    setUser(null);
    setFeatures(null);
  }, []);

  const updateUser = useCallback((patch) => {
    setUser(prev => {
      const updated = { ...prev, ...patch };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, features, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
