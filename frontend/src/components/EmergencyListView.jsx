import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ShieldAlert, CheckCircle2 } from 'lucide-react';
import api from '../api/axios';
import PageHeader from './PageHeader';
import LoadingState from './LoadingState';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import Pagination from './Pagination';
import EmergencyCloseDialog, { RESULT_LABELS, isClosedResult } from './EmergencyCloseDialog';

/**
 * EmergencyListView — the emergency list every oversight role sees
 * (school / affiliation / province / admin), with a "ปิดเหตุ" button on each
 * open emergency. `basePath` is the API prefix, e.g. '/school'; the list is
 * `${basePath}/emergencies` and close is `${basePath}/emergencies/:id/close`.
 * Pass canClose={false} to keep a read-only list.
 */
export default function EmergencyListView({
  basePath, title = 'เหตุฉุกเฉิน', subtitle, emptyDescription, canClose = true,
  closeResults = ['RESOLVED', 'FALSE_ALARM'],
}) {
  const [emergencies, setEmergencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ page: 1, per_page: 20, total: 0 });
  const [closing, setClosing] = useState(null);

  const fetchEmergencies = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`${basePath}/emergencies?page=${page}&per_page=20`);
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
  }, [basePath]);

  useEffect(() => {
    fetchEmergencies(1);
  }, [fetchEmergencies]);

  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <PageHeader title={title} subtitle={subtitle} />

      {error && <ErrorState message={error} className="mb-4" />}

      {loading ? (
        <LoadingState />
      ) : emergencies.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          variant="success"
          title="ไม่มีเหตุฉุกเฉิน"
          description={emptyDescription}
        />
      ) : (
        <>
          <div className="space-y-3">
            {emergencies.map((em) => {
              const closed = isClosedResult(em.result);
              return (
                <div key={em.id} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-danger-ink shrink-0" strokeWidth={2.2} aria-hidden="true" />
                      <span className="sr-only">เหตุฉุกเฉิน</span>
                      <span className="font-semibold text-gray-800">{em.plate_no || 'ไม่ระบุรถ'}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        em.channel === 'line'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {em.channel === 'line' ? 'LINE' : 'เว็บ'}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${closed ? 'bg-success-soft text-success-ink' : 'bg-danger-soft text-danger-ink'}`}>
                        {closed ? `ปิดแล้ว · ${RESULT_LABELS[String(em.result).toUpperCase()] || em.result}` : 'ยังไม่ปิด'}
                      </span>
                    </div>
                    <span className="text-xs text-ink-muted">
                      {em.reported_at ? new Date(em.reported_at).toLocaleString('th-TH', {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      }) : ''}
                    </span>
                  </div>

                  <p className="text-sm text-gray-700 mb-2">{em.detail}</p>

                  {em.note && (
                    <p className="text-xs text-ink-muted whitespace-pre-line">
                      <span className="font-medium">หมายเหตุ/ประวัติ:</span> {em.note}
                    </p>
                  )}
                  {em.result && !closed && (
                    <p className="text-xs text-ink-muted mt-1">
                      <span className="font-medium">ผลลัพธ์:</span> {RESULT_LABELS[String(em.result).toUpperCase()] || em.result}
                    </p>
                  )}
                  {em.reported_by_name && (
                    <p className="text-xs text-ink-muted mt-2">
                      รายงานโดย: {em.reported_by_name}
                    </p>
                  )}
                  {canClose && !closed && (
                    <div className="mt-3">
                      <button type="button" onClick={() => setClosing(em)}
                        className="focus-ring inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg border border-surface-border bg-surface-raised text-sm font-semibold text-ink hover:bg-surface">
                        <CheckCircle2 className="w-4 h-4 text-success-ink" aria-hidden="true" />
                        ปิดเหตุ
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <Pagination page={meta.page} totalPages={totalPages} total={meta.total} shown={emergencies.length} unit="รายการ" onPage={(p) => fetchEmergencies(p)} />
          )}
        </>
      )}

      {closing && (
        <EmergencyCloseDialog
          emergency={closing}
          closeUrl={`${basePath}/emergencies/${closing.id}/close`}
          results={closeResults}
          onClose={() => setClosing(null)}
          onClosed={() => { setClosing(null); fetchEmergencies(meta.page || 1); }}
        />
      )}
    </div>
  );
}
