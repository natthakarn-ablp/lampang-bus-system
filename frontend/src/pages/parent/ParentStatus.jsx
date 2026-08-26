import { useState, useEffect } from 'react';
import axios from 'axios'; // Raw axios intentional — public LIFF page, no JWT auth
import { getLiffIdToken } from '../../utils/liff';
import AppCard from '../../components/ui/AppCard';

const STATUS_MAP = {
  CHECKED_IN:  { label: 'รับแล้ว',  cls: 'bg-success-soft text-success border-success/30', icon: '✅' },
  CHECKED_OUT: { label: 'ส่งแล้ว',  cls: 'bg-brand-100 text-brand-700 border-brand-200',  icon: '✅' },
  ABSENT:      { label: 'ไม่มา',   cls: 'bg-red-100 text-red-700 border-red-200',    icon: '❌' },
  CANCELLED:   { label: 'ยกเลิก',  cls: 'bg-surface text-ink-muted border-surface-border',  icon: '↩️' },
};

export default function ParentStatus() {
  const [idToken, setIdToken] = useState('');
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [eta, setEta] = useState(null);
  const [view, setView] = useState('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Identity comes from the verified LIFF id_token — never a query param.
      const token = await getLiffIdToken();
      if (cancelled) return;
      setIdToken(token);
      if (!token) {
        // Phase 11A audit fix C5: clear error message when not in LIFF
        if (!cancelled) setError('กรุณาเปิดหน้านี้ผ่านลิงก์ใน LINE OA เท่านั้น — ไม่สามารถเข้าถึงได้โดยตรง');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        const res = await axios.get('/api/parent/children', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) setChildren(res.data.data || []);
      } catch (err) {
        if (!cancelled) {
          const code = err.response?.status;
          setError(
            code === 401 || code === 403
              ? 'กรุณาเปิดผ่าน LINE และผูกบัญชีก่อนใช้งาน'
              : err.response?.data?.message || 'ไม่สามารถโหลดข้อมูลได้'
          );
        }
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
      const res = await axios.get(`/api/parent/children/${child.id}/status`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      setStatus(res.data.data);
    } catch {
      setStatus(null);
    }
  }

  async function viewHistory(child) {
    setSelectedChild(child);
    setView('history');
    try {
      const res = await axios.get(`/api/parent/children/${child.id}/history?days=7`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      setHistory(res.data.data?.history || []);
    } catch {
      setHistory([]);
    }
  }

  async function viewEta(child) {
    setSelectedChild(child);
    setView('eta');
    setEta(null);
    try {
      const res = await axios.get(`/api/parent/children/${child.id}/eta`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      setEta(res.data.data);
    } catch {
      setEta(null);
    }
  }

  function goBack() {
    setView('list');
    setSelectedChild(null);
    setStatus(null);
    setHistory([]);
    setEta(null);
  }

  // ── Unlinked state (no LIFF id_token — opened outside LINE or not linked) ──
  if (!loading && !idToken) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <AppCard padding="lg" className="max-w-sm w-full text-center">
          <p className="text-5xl mb-4">🔗</p>
          <h1 className="text-xl font-semibold text-ink mb-3">ยังไม่ได้ผูกบัญชี LINE</h1>
          <p className="text-base text-ink-muted mb-6">ทำตามขั้นตอนด้านล่าง เพื่อดูสถานะรับ-ส่งบุตรหลาน</p>

          <div className="text-left space-y-4 mb-6">
            <StepItem number="1" text="เพิ่มเพื่อน LINE OA ระบบรถรับส่งนักเรียน" />
            <StepItem number="2" text='พิมพ์คำว่า "ผูกบัญชี" ในแชท' />
            <StepItem number="3" text="กรอกเบอร์โทร + รหัสนักเรียนของบุตรหลาน" />
            <StepItem number="4" text="รอโรงเรียนอนุมัติ" />
          </div>

          <p className="text-sm text-ink-muted">หลังอนุมัติแล้ว เปิดหน้านี้อีกครั้ง</p>
        </AppCard>
      </div>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600 mx-auto mb-3" />
          <p className="text-ink-muted">กำลังโหลดข้อมูล…</p>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <AppCard padding="lg" className="max-w-sm w-full text-center border-danger/30">
          <p className="text-4xl mb-3">⚠️</p>
          <p className="text-base text-red-600 font-medium mb-4">{error}</p>
          <button onClick={() => window.location.reload()}
            className="bg-red-50 hover:bg-red-100 text-red-700 font-medium px-6 py-3 rounded-xl transition border border-red-200">
            ลองใหม่อีกครั้ง
          </button>
        </AppCard>
      </div>
    );
  }

  // ── No children linked ──
  if (children.length === 0) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <AppCard padding="lg" className="max-w-sm w-full text-center">
          <p className="text-5xl mb-4">👨‍👩‍👧‍👦</p>
          <h1 className="text-xl font-semibold text-ink mb-3">ไม่พบข้อมูลบุตรหลาน</h1>
          <p className="text-base text-ink-muted mb-2">
            บัญชี LINE ของคุณยังไม่ได้ผูกกับนักเรียน
          </p>
          <p className="text-base text-amber-600 font-medium mb-6">
            หรืออยู่ระหว่างรอโรงเรียนอนุมัติ
          </p>

          <div className="text-left space-y-3 mb-6 bg-surface rounded-xl p-4">
            <p className="text-sm font-semibold text-ink-muted mb-2">วิธีผูกบัญชี:</p>
            <StepItem number="1" text='พิมพ์ "ผูกบัญชี" ใน LINE OA' />
            <StepItem number="2" text="กรอกเบอร์โทร + รหัสนักเรียนของบุตรหลาน" />
            <StepItem number="3" text="รอโรงเรียนอนุมัติ" />
          </div>

          <button onClick={() => window.location.reload()}
            className="focus-ring w-full bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-semibold min-h-[48px] py-3 rounded-xl transition">
            รีเฟรชข้อมูล
          </button>
        </AppCard>
      </div>
    );
  }

  // ── Main view ──
  return (
    <div className="min-h-screen bg-surface pb-safe">
      {/* Header */}
      <div className="bg-navy-700 text-white px-4 py-4 shadow-soft">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-semibold text-lg">ระบบรถรับส่งนักเรียน</h1>
            <p className="text-navy-200 text-sm">สำหรับผู้ปกครอง</p>
          </div>
          {view !== 'list' ? (
            <button onClick={goBack}
              className="bg-white/15 hover:bg-white/25 active:bg-white/30 font-semibold text-base px-5 py-2.5 rounded-xl transition">
              ← กลับ
            </button>
          ) : (
            <button onClick={() => window.location.reload()}
              className="bg-white/15 hover:bg-white/25 active:bg-white/30 text-sm px-4 py-2 rounded-xl transition">
              🔄 รีเฟรช
            </button>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 pb-8">
        {/* ── Children list ── */}
        {view === 'list' && (
          <div className="space-y-4">
            <p className="text-base font-semibold text-ink-muted">
              บุตรหลานของคุณ ({children.length} คน)
            </p>
            {children.map(child => (
              <AppCard key={child.id} padding="none" className="overflow-hidden">
                {/* Child info */}
                <div className="p-4 pb-3">
                  <p className="text-lg font-semibold text-ink">
                    {child.first_name} {child.last_name}
                  </p>
                  <p className="text-base text-ink-muted mt-0.5">
                    {child.grade && child.classroom ? `${child.grade}/${child.classroom}` : child.grade || '-'}
                    {child.school_name && (
                      <span className="text-ink-muted"> · {child.school_name}</span>
                    )}
                  </p>
                  {child.plate_no && (
                    <p className="text-sm text-brand-600 font-medium mt-1.5">
                      🚌 {child.plate_no}
                      {child.driver_name && <span className="text-ink-muted font-normal"> · {child.driver_name}</span>}
                    </p>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 px-4 pb-4">
                  <button onClick={() => viewStatus(child)}
                    className="flex-1 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-semibold py-3 rounded-xl transition text-base">
                    📋 สถานะวันนี้
                  </button>
                  <button onClick={() => viewEta(child)}
                    className="flex-1 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 text-amber-700 font-semibold py-3 rounded-xl transition border-2 border-amber-200 text-base">
                    📍 ETA
                  </button>
                  <button onClick={() => viewHistory(child)}
                    className="flex-1 bg-brand-50 hover:bg-brand-100 active:bg-brand-200 text-brand-700 font-semibold py-3 rounded-xl transition border-2 border-brand-200 text-base">
                    📅 ย้อนหลัง
                  </button>
                </div>
              </AppCard>
            ))}
          </div>
        )}

        {/* ── Today's status ── */}
        {view === 'status' && selectedChild && (
          <div className="space-y-4">
            {/* Child header */}
            <AppCard padding="md">
              <p className="text-lg font-semibold text-ink">
                {selectedChild.first_name} {selectedChild.last_name}
              </p>
              <p className="text-base text-ink-muted">
                {selectedChild.grade && selectedChild.classroom ? `${selectedChild.grade}/${selectedChild.classroom}` : selectedChild.grade || '-'}
                {selectedChild.school_name && ` · ${selectedChild.school_name}`}
              </p>
            </AppCard>

            <p className="text-base font-semibold text-ink-muted">สถานะวันนี้</p>

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
              <p className="text-sm text-ink-muted text-center bg-surface rounded-xl py-3">
                ยังไม่มีข้อมูลเช็คอินวันนี้
              </p>
            )}

            {/* Quick action */}
            <button onClick={() => viewStatus(selectedChild)}
              className="w-full bg-surface hover:bg-surface-border text-ink-muted font-medium py-3 rounded-xl transition text-base">
              🔄 รีเฟรชสถานะ
            </button>
          </div>
        )}

        {/* ── History ── */}
        {view === 'history' && selectedChild && (
          <div className="space-y-4">
            {/* Child header */}
            <AppCard padding="md">
              <p className="text-lg font-semibold text-ink">
                {selectedChild.first_name} {selectedChild.last_name}
              </p>
              <p className="text-base text-ink-muted">
                {selectedChild.school_name || '-'}
              </p>
            </AppCard>

            <p className="text-base font-semibold text-ink-muted">ประวัติ 7 วันล่าสุด</p>

            {history.length === 0 ? (
              <AppCard padding="lg" className="text-center">
                <p className="text-ink-muted text-lg">ไม่มีประวัติในช่วงนี้</p>
              </AppCard>
            ) : (
              <div className="space-y-2">
                {history.map((h, i) => {
                  const st = STATUS_MAP[h.status] || { label: h.status, cls: 'bg-surface text-ink-muted border-surface-border', icon: '—' };
                  const dateStr = new Date(h.check_date).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
                  const timeStr = h.checked_at ? new Date(h.checked_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-';

                  return (
                    <AppCard key={i} padding="sm" className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-base font-medium text-ink">{dateStr}</p>
                        <p className="text-sm text-ink-muted">
                          {h.session === 'morning' ? '🌅 ส่งเช้า' : '🌆 รับเย็น'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`inline-block text-sm font-semibold px-3 py-1 rounded-full border ${st.cls}`}>
                          {st.icon} {st.label}
                        </span>
                        <p className="text-sm text-ink-muted mt-0.5">{timeStr}</p>
                      </div>
                    </AppCard>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── ETA (Phase 11A) ── */}
        {view === 'eta' && selectedChild && (
          <div className="space-y-4">
            <AppCard padding="md">
              <p className="text-lg font-semibold text-ink">
                {selectedChild.first_name} {selectedChild.last_name}
              </p>
              <p className="text-base text-ink-muted">
                {selectedChild.school_name || '-'}
              </p>
            </AppCard>

            <p className="text-base font-semibold text-ink-muted">เวลาถึงโดยประมาณ (ETA)</p>

            {eta == null ? (
              <AppCard padding="lg" className="text-center">
                <p className="text-4xl mb-2">📍</p>
                <p className="text-ink-muted text-base">
                  ยังไม่มีข้อมูล ETA — รถอาจออฟไลน์ หรือยังไม่เริ่มรอบ
                </p>
                <p className="text-sm text-ink-muted mt-2">
                  ลองกดรีเฟรชอีกครั้งเมื่อรถเริ่มวิ่ง
                </p>
              </AppCard>
            ) : (
              <AppCard padding="lg" className="text-center">
                <p className="text-5xl mb-3">🚌</p>
                <p className="text-sm text-ink-muted mb-1">รถ {eta.plate_no}</p>
                <p className="text-base font-semibold text-ink mb-3">
                  จุด: {eta.label}
                </p>
                <div className="inline-flex flex-col items-center bg-amber-50 border-2 border-amber-200 rounded-2xl px-6 py-4">
                  <p className="text-3xl font-bold text-amber-700 tabular-nums">
                    {eta.eta_seconds != null
                      ? `${Math.max(1, Math.round(eta.eta_seconds / 60))} นาที`
                      : '—'}
                  </p>
                  <p className="text-sm text-amber-600 mt-1">
                    ระยะทาง {eta.distance_meters != null ? `${(eta.distance_meters / 1000).toFixed(1)} กม.` : 'ไม่ทราบ'}
                  </p>
                  <p className="text-xs text-amber-500 mt-1">
                    ความมั่นใจ: {eta.confidence === 'HIGH' ? 'สูง' : eta.confidence === 'MEDIUM' ? 'ปานกลาง' : eta.confidence === 'LOW' ? 'ต่ำ' : 'ไม่ทราบ'}
                  </p>
                </div>
                <p className="text-xs text-ink-muted mt-3">
                  อัปเดต {eta.age_seconds != null ? `${eta.age_seconds}s ที่แล้ว` : '-'}
                </p>
                <button onClick={() => viewEta(selectedChild)}
                  className="mt-4 bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold px-6 py-2.5 rounded-xl border-2 border-amber-200 transition">
                  🔄 รีเฟรช ETA
                </button>
              </AppCard>
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
      <span className="bg-navy-700 text-white font-semibold w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0">
        {number}
      </span>
      <p className="text-base text-ink leading-snug pt-0.5">{text}</p>
    </div>
  );
}

/* ── Status card for today view ── */
function StatusCard({ label, icon, done, time, doneText, pendingText }) {
  const timeStr = time ? new Date(time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className={`rounded-2xl border-2 p-4 text-center ${done ? 'bg-success-soft border-success/40' : 'bg-surface border-surface-border'}`}>
      <p className="text-3xl mb-2">{done ? '✅' : '⏳'}</p>
      <p className="text-base font-semibold text-ink">{icon} {label}</p>
      <p className={`text-sm font-medium mt-1 ${done ? 'text-success' : 'text-ink-muted'}`}>
        {done ? doneText : pendingText}
      </p>
      {done && timeStr && (
        <p className="text-lg font-semibold text-success mt-1">{timeStr} น.</p>
      )}
    </div>
  );
}
