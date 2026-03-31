import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';
import { resolveSession, SESSION_LABEL, DONE_LABEL, ALL_DONE_LABEL, SESSION_TAG } from '../../utils/session';

/**
 * DriverDashboard — the /driver index page (ภาพรวมวันนี้).
 *
 * Rendered by App.jsx as the index child of the /driver nested route.
 * Layout (sidebar) is provided by DriverLayout via <Outlet />.
 */
export default function DriverDashboard() {
  const navigate = useNavigate();

  const [status,  setStatus]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api.get('/driver/status-today')
      .then((res) => setStatus(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'ไม่สามารถโหลดข้อมูลได้'))
      .finally(() => setLoading(false));
  }, []);

  // Session resolved from backend (source of truth); fallback to browser time.
  const session = resolveSession(status?.current_session);
  const s = status?.summary;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800">ภาพรวมวันนี้</h1>
          {status?.vehicle && (
            <p className="text-sm text-gray-500 mt-1">
              รถ: <span className="font-medium">{status.vehicle.plate_no}</span>
            </p>
          )}
          {/* Current mode badge */}
          <span
            className={`inline-block mt-2 text-sm font-semibold px-3 py-1 rounded-full ${
              session === 'morning'
                ? 'bg-orange-100 text-orange-700'
                : 'bg-indigo-100 text-indigo-700'
            }`}
          >
            {session === 'morning' ? '🌅' : '🌆'} โหมดปัจจุบัน: {SESSION_LABEL[session]}
          </span>
        </div>

        {/* Emergency button — navigates to dedicated page */}
        <button
          onClick={() => navigate('/driver/emergency')}
          className="flex items-center gap-2 bg-red-100 hover:bg-red-200 text-red-700 font-medium text-sm px-4 py-2 rounded-lg transition flex-shrink-0"
        >
          🚨 แจ้งเหตุฉุกเฉิน
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <DashboardCard
              label="นักเรียนทั้งหมด"
              value={s?.total ?? 0}
              color="blue"
            />
            <DashboardCard
              label={DONE_LABEL.morning}
              value={s?.morning_done ?? 0}
              sub={
                parseInt(s?.morning_pending ?? 1, 10) === 0
                  ? ALL_DONE_LABEL.morning
                  : `รอ ${s?.morning_pending ?? 0} คน`
              }
              color={parseInt(s?.morning_pending ?? 1, 10) === 0 ? 'green' : 'gray'}
            />
            <DashboardCard
              label={DONE_LABEL.evening}
              value={s?.evening_done ?? 0}
              sub={
                parseInt(s?.evening_pending ?? 1, 10) === 0
                  ? ALL_DONE_LABEL.evening
                  : `รอ ${s?.evening_pending ?? 0} คน`
              }
              color={parseInt(s?.evening_pending ?? 1, 10) === 0 ? 'green' : 'gray'}
            />
          </div>

          {/* Recent activity */}
          {status?.recent?.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                กิจกรรมล่าสุด
              </h2>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {status.recent.map((log) => {
                  const actionLabel =
                    log.status === 'CHECKED_IN'
                      ? (log.session === 'morning' ? 'ส่งแล้ว' : 'รับแล้ว')
                      : 'ส่งแล้ว';

                  return (
                    <div key={log.id} className="flex items-center justify-between px-5 py-3 text-sm">
                      <span className="text-gray-700">{log.student_name}</span>
                      <div className="flex items-center gap-3 text-gray-500">
                        <span className="text-xs">{SESSION_TAG[log.session] ?? log.session}</span>
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            log.session === 'morning'
                              ? 'bg-orange-100 text-orange-700'
                              : 'bg-indigo-100 text-indigo-700'
                          }`}
                        >
                          {actionLabel}
                        </span>
                        <span className="text-xs">
                          {new Date(log.checked_at).toLocaleTimeString('th-TH', {
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
