import { useState, useEffect } from 'react';
import { Key, Search } from 'lucide-react';
import api from '../api/axios';
import { useAdminContext } from '../hooks/useAdminContext';

/**
 * Admin school selector — shown at top of school pages when role=admin.
 * Fetches school list from /api/province/schools and lets admin pick one.
 */
export function AdminSchoolSelector() {
  const { isAdmin, schoolId, setSchoolId } = useAdminContext();
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) return;
    api.get('/province/schools?per_page=200')
      .then(res => setSchools(res.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (!isAdmin) return null;

  return (
    <div className="bg-amber-50 border-2 border-amber-200 rounded-xl px-4 py-3 mb-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label className="text-sm font-semibold text-amber-800 shrink-0 inline-flex items-center gap-1.5">
          <Key className="w-4 h-4" strokeWidth={2} />
          Admin — เลือกโรงเรียน:
        </label>
        <select
          value={schoolId}
          onChange={(e) => setSchoolId(e.target.value)}
          disabled={loading}
          className="flex-1 border-2 border-amber-300 rounded-lg px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          <option value="">— เลือกโรงเรียน —</option>
          {schools.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Admin affiliation selector — shown at top of affiliation pages when role=admin.
 */
export function AdminAffiliationSelector() {
  const { isAdmin, affiliationId, setAffiliationId } = useAdminContext();
  const [affiliations, setAffiliations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) return;
    api.get('/province/affiliations')
      .then(res => setAffiliations(res.data.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (!isAdmin) return null;

  return (
    <div className="bg-amber-50 border-2 border-amber-200 rounded-xl px-4 py-3 mb-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label className="text-sm font-semibold text-amber-800 shrink-0 inline-flex items-center gap-1.5">
          <Key className="w-4 h-4" strokeWidth={2} />
          Admin — เลือกสังกัด:
        </label>
        <select
          value={affiliationId}
          onChange={(e) => setAffiliationId(e.target.value)}
          disabled={loading}
          className="flex-1 border-2 border-amber-300 rounded-lg px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          <option value="">— เลือกสังกัด —</option>
          {affiliations.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Empty state shown when admin hasn't selected a scope yet.
 */
export function AdminNoScopeMessage({ type }) {
  const label = type === 'school' ? 'โรงเรียน' : 'สังกัด';
  return (
    <div className="text-center py-16">
      <Search className="w-10 h-10 mx-auto mb-4 text-ink-muted" strokeWidth={1.6} />
      <p className="text-lg font-semibold text-gray-600 mb-2">กรุณาเลือก{label}ก่อน</p>
      <p className="text-sm text-ink-muted">เลือก{label}จากเมนูด้านบนเพื่อดูข้อมูล</p>
    </div>
  );
}
