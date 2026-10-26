import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ShieldAlert} from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import Pagination from '../../components/Pagination';

export default function EmergencyList() {
  const [emergencies, setEmergencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ page: 1, per_page: 20, total: 0 });

  const fetchEmergencies = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/school/emergencies?page=${page}&per_page=20`);
      // A response without `meta` (or without `data`) must not blank the page:
      // `meta.total` is read on every render, so storing undefined here threw
      // and the ErrorBoundary replaced the whole list.
      const rows = Array.isArray(res.data.data) ? res.data.data : [];
      setEmergencies(rows);
      setMeta(res.data.meta || { page, per_page: 20, total: rows.length });
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmergencies(1);
  }, [fetchEmergencies]);

  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <PageHeader title="เหตุฉุกเฉิน" subtitle="เหตุฉุกเฉินที่รายงานจากรถรับส่งของโรงเรียน" />

      {error && <ErrorState message={error} className="mb-4" />}

      {loading ? (
        <LoadingState />
      ) : emergencies.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          variant="success"
          title="ไม่มีเหตุฉุกเฉิน"
          description="ยังไม่มีรายงานเหตุฉุกเฉินจากรถที่ให้บริการโรงเรียนนี้"
        />
      ) : (
        <>
          <div className="space-y-3">
            {emergencies.map((em) => (
              <div
                key={em.id}
                className="bg-white rounded-xl border border-gray-200 p-5"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-danger-ink shrink-0" strokeWidth={2.2} aria-hidden="true" />
                    <span className="sr-only">เหตุฉุกเฉิน</span>
                    <span className="font-semibold text-gray-800">{em.plate_no}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      em.channel === 'line'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}>
                      {em.channel === 'line' ? 'LINE' : 'เว็บ'}
                    </span>
                  </div>
                  <span className="text-xs text-ink-muted">
                    {new Date(em.reported_at).toLocaleString('th-TH', {
                      year: 'numeric', month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>

                <p className="text-sm text-gray-700 mb-2">{em.detail}</p>

                {em.note && (
                  <p className="text-xs text-ink-muted">
                    <span className="font-medium">หมายเหตุ:</span> {em.note}
                  </p>
                )}
                {em.result && (
                  <p className="text-xs text-ink-muted mt-1">
                    <span className="font-medium">ผลลัพธ์:</span> {em.result}
                  </p>
                )}
                {em.reported_by_name && (
                  <p className="text-xs text-ink-muted mt-2">
                    รายงานโดย: {em.reported_by_name}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <Pagination page={meta.page} totalPages={totalPages} total={meta.total} shown={emergencies.length} unit="รายการ" onPage={(p) => fetchEmergencies(p)} />
          )}
        </>
      )}
    </div>
  );
}
