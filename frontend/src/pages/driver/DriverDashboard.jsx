import { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import api from '../../api/axios';
import Layout from '../../components/Layout';
import DashboardCard from '../../components/DashboardCard';
import StudentList from './StudentList';
import { resolveSession, SESSION_LABEL, DONE_LABEL, ALL_DONE_LABEL, SESSION_TAG } from '../../utils/session';

// ─── Emergency Modal ──────────────────────────────────────────────────────────

function EmergencyModal({ onClose }) {
  const [detail,  setDetail]  = useState('');
  const [note,    setNote]    = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error,   setError]   = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/driver/emergency', { detail, note });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.message || 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-lg font-bold text-gray-800 mb-2">แจ้งเหตุฉุกเฉินแล้ว</h2>
          <p className="text-gray-500 text-sm mb-6">ทีมงานจะดำเนินการโดยเร็ว</p>
          <button
            onClick={onClose}
            className="bg-blue-600 text-white px-8 py-2 rounded-lg font-medium hover:bg-blue-700"
          >
            ปิด
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <h2 className="text-lg font-bold text-red-700 mb-5">🚨 แจ้งเหตุฉุกเฉิน</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รายละเอียด *</label>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              required
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              placeholder="อธิบายเหตุการณ์ที่เกิดขึ้น"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              placeholder="ข้อมูลเพิ่มเติม (ถ้ามี)"
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition"
            >
              {loading ? 'กำลังส่ง…' : 'แจ้งเหตุ'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-lg transition"
            >
              ยกเลิก
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Today's Status Overview ──────────────────────────────────────────────────

function StatusOverview() {
  const [status,  setStatus]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [showEmergency, setShowEmergency] = useState(false);

  useEffect(() => {
    api.get('/driver/status-today')
      .then((res) => setStatus(res.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Session resolved from backend (source of truth); fallback to browser time.
  const session = resolveSession(status?.current_session);

  const s = status?.summary;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header row */}
      <div className="flex items-start justify-between mb-6">
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
        <button
          onClick={() => setShowEmergency(true)}
          className="flex items-center gap-2 bg-red-100 hover:bg-red-200 text-red-700 font-medium text-sm px-4 py-2 rounded-lg transition flex-shrink-0"
        >
          🚨 แจ้งเหตุฉุกเฉิน
        </button>
      </div>

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
                  // Display label respects session context:
                  // morning CHECKED_IN = "ส่งแล้ว", evening CHECKED_IN = "รับแล้ว"
                  const actionLabel =
                    log.status === 'CHECKED_IN'
                      ? (log.session === 'morning' ? 'ส่งแล้ว' : 'รับแล้ว')
                      : 'ส่งแล้ว'; // CHECKED_OUT fallback

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

      {showEmergency && (
        <EmergencyModal onClose={() => setShowEmergency(false)} />
      )}
    </div>
  );
}

// ─── Driver Dashboard (router shell) ─────────────────────────────────────────

export default function DriverDashboard() {
  return (
    <Layout>
      <Routes>
        <Route index           element={<StatusOverview />} />
        <Route path="roster"   element={<StudentList />} />
        <Route path="emergency" element={<StatusOverview />} />
      </Routes>
    </Layout>
  );
}
