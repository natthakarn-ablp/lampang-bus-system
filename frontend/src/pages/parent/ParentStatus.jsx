import { useState, useEffect } from 'react';
import axios from 'axios'; // Raw axios intentional — public LIFF page, no JWT auth
import { resolveLineUserId } from '../../utils/liff';

const STATUS_MAP = {
  CHECKED_IN:  { label: 'รับแล้ว',  cls: 'bg-green-100 text-green-700 border-green-200', icon: '✅' },
  CHECKED_OUT: { label: 'ส่งแล้ว',  cls: 'bg-blue-100 text-blue-700 border-blue-200',  icon: '✅' },
  ABSENT:      { label: 'ไม่มา',   cls: 'bg-red-100 text-red-700 border-red-200',    icon: '❌' },
  CANCELLED:   { label: 'ยกเลิก',  cls: 'bg-gray-100 text-gray-500 border-gray-200',  icon: '↩️' },
};

export default function ParentStatus() {
  const [lineUserId, setLineUserId] = useState('');
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [view, setView] = useState('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await resolveLineUserId();
      if (cancelled) return;
      setLineUserId(id);
      if (!id) { setLoading(false); return; }
      setLoading(true);
      setError('');
      try {
        const res = await axios.get(`/api/parent/children?line_user_id=${encodeURIComponent(id)}`);
        if (!cancelled) setChildren(res.data.data || []);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || 'ไม่สามารถโหลดข้อมูลได้');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function viewStatus(child) {
    setSelectedChild(child);
    setView('status');
    try {
      const res = await axios.get(`/api/parent/children/${child.id}/status?line_user_id=${encodeURIComponent(lineUserId)}`);
      setStatus(res.data.data);
    } catch {
      setStatus(null);
    }
  }

  async function viewHistory(child) {
    setSelectedChild(child);
    setView('history');
    try {
      const res = await axios.get(`/api/parent/children/${child.id}/history?line_user_id=${encodeURIComponent(lineUserId)}&days=7`);
      setHistory(res.data.data?.history || []);
    } catch {
      setHistory([]);
    }
  }

  function goBack() {
    setView('list');
    setSelectedChild(null);
    setStatus(null);
    setHistory([]);
  }

  // ── Unlinked state ──
  if (!loading && !lineUserId) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 max-w-sm w-full text-center">
          <p className="text-5xl mb-4">🔗</p>
          <h1 className="text-xl font-semibold text-gray-800 mb-3">ยังไม่ได้ผูกบัญชี LINE</h1>
          <p className="text-base text-gray-600 mb-6">ทำตามขั้นตอนด้านล่าง เพื่อดูสถานะรับ-ส่งบุตรหลาน</p>

          <div className="text-left space-y-4 mb-6">
            <StepItem number="1" text="เพิ่มเพื่อน LINE OA ระบบรถรับส่งนักเรียน" />
            <StepItem number="2" text='พิมพ์คำว่า "ผูกบัญชี" ในแชท' />
            <StepItem number="3" text="กรอกเลขบัตรประชาชนของบุตรหลาน" />
            <StepItem number="4" text="รอโรงเรียนอนุมัติ" />
          </div>

          <p className="text-sm text-gray-400">หลังอนุมัติแล้ว เปิดหน้านี้อีกครั้ง</p>
        </div>
      </div>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mx-auto mb-3" />
          <p className="text-gray-400">กำลังโหลดข้อมูล…</p>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-6 max-w-sm w-full text-center">
          <p className="text-4xl mb-3">⚠️</p>
          <p className="text-base text-red-600 font-medium mb-4">{error}</p>
          <button onClick={() => window.location.reload()}
            className="bg-red-50 hover:bg-red-100 text-red-700 font-medium px-6 py-3 rounded-xl transition border border-red-200">
            ลองใหม่อีกครั้ง
          </button>
        </div>
      </div>
    );
  }

  // ── No children linked ──
  if (children.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-green-50 to-white flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 max-w-sm w-full text-center">
          <p className="text-5xl mb-4">👨‍👩‍👧‍👦</p>
          <h1 className="text-xl font-semibold text-gray-800 mb-3">ไม่พบข้อมูลบุตรหลาน</h1>
          <p className="text-base text-gray-600 mb-2">
            บัญชี LINE ของคุณยังไม่ได้ผูกกับนักเรียน
          </p>
          <p className="text-base text-amber-600 font-medium mb-6">
            หรืออยู่ระหว่างรอโรงเรียนอนุมัติ
          </p>

          <div className="text-left space-y-3 mb-6 bg-gray-50 rounded-xl p-4">
            <p className="text-sm font-semibold text-gray-600 mb-2">วิธีผูกบัญชี:</p>
            <StepItem number="1" text='พิมพ์ "ผูกบัญชี" ใน LINE OA' />
            <StepItem number="2" text="กรอกเลขบัตรประชาชนบุตรหลาน" />
            <StepItem number="3" text="รอโรงเรียนอนุมัติ" />
          </div>

          <button onClick={() => window.location.reload()}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-xl transition">
            รีเฟรชข้อมูล
          </button>
        </div>
      </div>
    );
  }

  // ── Main view ──
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-green-600 text-white px-4 py-4 shadow-md">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-lg">ระบบรถรับส่งนักเรียน</h1>
            <p className="text-green-100 text-sm">สำหรับผู้ปกครอง</p>
          </div>
          {view !== 'list' ? (
            <button onClick={goBack}
              className="bg-green-500 hover:bg-green-400 active:bg-green-300 font-semibold text-base px-5 py-2.5 rounded-xl transition">
              ← กลับ
            </button>
          ) : (
            <button onClick={() => window.location.reload()}
              className="bg-green-500 hover:bg-green-400 active:bg-green-300 text-sm px-4 py-2 rounded-xl transition">
              🔄 รีเฟรช
            </button>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 pb-8">
        {/* ── Children list ── */}
        {view === 'list' && (
          <div className="space-y-4">
            <p className="text-base font-semibold text-gray-600">
              บุตรหลานของคุณ ({children.length} คน)
            </p>
            {children.map(child => (
              <div key={child.id} className="bg-white rounded-2xl border-2 border-gray-100 shadow-sm overflow-hidden">
                {/* Child info */}
                <div className="p-4 pb-3">
                  <p className="text-lg font-semibold text-gray-900">
                    {child.first_name} {child.last_name}
                  </p>
                  <p className="text-base text-gray-500 mt-0.5">
                    {child.grade && child.classroom ? `${child.grade}/${child.classroom}` : child.grade || '-'}
                    {child.school_name && (
                      <span className="text-gray-400"> · {child.school_name}</span>
                    )}
                  </p>
                  {child.plate_no && (
                    <p className="text-sm text-blue-600 font-medium mt-1.5">
                      🚌 {child.plate_no}
                      {child.driver_name && <span className="text-gray-500 font-normal"> · {child.driver_name}</span>}
                    </p>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 px-4 pb-4">
                  <button onClick={() => viewStatus(child)}
                    className="flex-1 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold py-3 rounded-xl transition text-base">
                    📋 สถานะวันนี้
                  </button>
                  <button onClick={() => viewHistory(child)}
                    className="flex-1 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 text-blue-700 font-semibold py-3 rounded-xl transition border-2 border-blue-200 text-base">
                    📅 ย้อนหลัง
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Today's status ── */}
        {view === 'status' && selectedChild && (
          <div className="space-y-4">
            {/* Child header */}
            <div className="bg-white rounded-2xl border-2 border-gray-100 p-4">
              <p className="text-lg font-semibold text-gray-900">
                {selectedChild.first_name} {selectedChild.last_name}
              </p>
              <p className="text-base text-gray-500">
                {selectedChild.grade && selectedChild.classroom ? `${selectedChild.grade}/${selectedChild.classroom}` : selectedChild.grade || '-'}
                {selectedChild.school_name && ` · ${selectedChild.school_name}`}
              </p>
            </div>

            <p className="text-base font-semibold text-gray-600">สถานะวันนี้</p>

            {/* Morning / Evening cards */}
            <div className="grid grid-cols-2 gap-3">
              <StatusCard
                label="ส่งเช้า"
                icon="🌅"
                done={status?.morning_done}
                time={status?.morning_ts}
                doneText="ส่งถึงแล้ว"
                pendingText="ยังไม่ส่ง"
              />
              <StatusCard
                label="รับเย็น"
                icon="🌆"
                done={status?.evening_done}
                time={status?.evening_ts}
                doneText="รับแล้ว"
                pendingText="ยังไม่รับ"
              />
            </div>

            {!status?.morning_done && !status?.evening_done && (
              <p className="text-sm text-gray-400 text-center bg-gray-50 rounded-xl py-3">
                ยังไม่มีข้อมูลเช็คอินวันนี้
              </p>
            )}

            {/* Quick action */}
            <button onClick={() => viewStatus(selectedChild)}
              className="w-full bg-gray-100 hover:bg-gray-200 text-gray-600 font-medium py-3 rounded-xl transition text-base">
              🔄 รีเฟรชสถานะ
            </button>
          </div>
        )}

        {/* ── History ── */}
        {view === 'history' && selectedChild && (
          <div className="space-y-4">
            {/* Child header */}
            <div className="bg-white rounded-2xl border-2 border-gray-100 p-4">
              <p className="text-lg font-semibold text-gray-900">
                {selectedChild.first_name} {selectedChild.last_name}
              </p>
              <p className="text-base text-gray-500">
                {selectedChild.school_name || '-'}
              </p>
            </div>

            <p className="text-base font-semibold text-gray-600">ประวัติ 7 วันล่าสุด</p>

            {history.length === 0 ? (
              <div className="text-center py-10 bg-white rounded-2xl border border-gray-100">
                <p className="text-gray-400 text-lg">ไม่มีประวัติในช่วงนี้</p>
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((h, i) => {
                  const st = STATUS_MAP[h.status] || { label: h.status, cls: 'bg-gray-100 text-gray-500 border-gray-200', icon: '—' };
                  const dateStr = new Date(h.check_date).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
                  const timeStr = h.checked_at ? new Date(h.checked_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-';

                  return (
                    <div key={i} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-medium text-gray-800">{dateStr}</p>
                        <p className="text-sm text-gray-500">
                          {h.session === 'morning' ? '🌅 ส่งเช้า' : '🌆 รับเย็น'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`inline-block text-sm font-semibold px-3 py-1 rounded-full border ${st.cls}`}>
                          {st.icon} {st.label}
                        </span>
                        <p className="text-sm text-gray-400 mt-0.5">{timeStr}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Step item for onboarding ── */
function StepItem({ number, text }) {
  return (
    <div className="flex items-start gap-3">
      <span className="bg-green-600 text-white font-semibold w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0">
        {number}
      </span>
      <p className="text-base text-gray-700 leading-snug pt-0.5">{text}</p>
    </div>
  );
}

/* ── Status card for today view ── */
function StatusCard({ label, icon, done, time, doneText, pendingText }) {
  const timeStr = time ? new Date(time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className={`rounded-2xl border-2 p-4 text-center ${done ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200'}`}>
      <p className="text-3xl mb-2">{done ? '✅' : '⏳'}</p>
      <p className="text-base font-semibold text-gray-700">{icon} {label}</p>
      <p className={`text-sm font-medium mt-1 ${done ? 'text-green-700' : 'text-gray-400'}`}>
        {done ? doneText : pendingText}
      </p>
      {done && timeStr && (
        <p className="text-lg font-semibold text-green-800 mt-1">{timeStr} น.</p>
      )}
    </div>
  );
}
