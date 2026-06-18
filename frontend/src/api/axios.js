import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor: inject access token + admin scope ──────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // Auto-inject admin scope params for school/affiliation APIs
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.role === 'admin') {
      const url = config.url || '';
      if (url.startsWith('/school/') || url === '/school') {
        const sid = sessionStorage.getItem('admin_school_id');
        if (sid) {
          config.params = { ...config.params, school_id: sid };
          // Also inject into body for POST/PUT
          if (config.data && typeof config.data === 'object' && !config.data.school_id) {
            config.data.school_id = sid;
          }
        }
      }
      if (url.startsWith('/affiliation/') || url === '/affiliation') {
        const aid = sessionStorage.getItem('admin_affiliation_id');
        if (aid) {
          config.params = { ...config.params, affiliation_id: aid };
        }
      }
    }
  } catch { /* ignore parse errors */ }

  return config;
});

// ── Response interceptor: auto-refresh on 401 ────────────────────────────────
let isRefreshing = false;
let pendingQueue = [];

function processQueue(error, token = null) {
  pendingQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token)
  );
  pendingQueue = [];
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    if (
      error.response?.status === 401 &&
      !original._retry &&
      localStorage.getItem('refresh_token')
    ) {
      // Audit 2026-06-18 (frontend-security): mark the queued request as retried
      // and ensure headers exist before mutating, so a still-401 response after
      // refresh can't loop and a request without a headers object can't throw.
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          pendingQueue.push({ resolve, reject });
        })
          .then((token) => {
            original._retry = true;
            original.headers = original.headers || {};
            original.headers.Authorization = `Bearer ${token}`;
            return api(original);
          })
          .catch(err => Promise.reject(err));
      }

      original._retry = true;
      isRefreshing = true;

      try {
        const res = await axios.post('/api/auth/refresh-token', {
          refresh_token: localStorage.getItem('refresh_token'),
        });
        const newToken = res.data.data.access_token;
        localStorage.setItem('access_token', newToken);
        processQueue(null, newToken);
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        // Refresh failed — clear storage and redirect to login
        localStorage.clear();
        window.location.href = '/login';
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;
