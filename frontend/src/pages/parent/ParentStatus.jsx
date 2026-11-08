import { Link2, Users, Bus, ClipboardList, MapPin, CalendarDays, Sunrise, Sunset, CheckCircle2, Clock} from 'lucide-react';
import { useState, useEffect } from 'react';
import axios from 'axios'; // Raw axios intentional — public LIFF page, no JWT auth
import { getLiffIdToken, isOutsideLineClient, LINE_OA_ID, LINE_OA_URL } from '../../utils/liff';
import OpenInLineCard from '../../components/parent/OpenInLineCard';
import AppCard from '../../components/ui/AppCard';
import { formatGradeClass } from '../../utils/student';
import ParentConsentModal from '../../components/consent/ParentConsentModal';

const STATUS_MAP = {
  CHECKED_IN:  { label: 'รับแล้ว',  cls: 'bg-success-soft text-success-ink border-success/30', icon: '✅' },
  CHECKED_OUT: { label: 'ส่งแล้ว',  cls: 'bg-brand-100 text-brand-700 border-brand-200',  icon: '✅' },
  ABSENT:      { label: 'ไม่มา',   cls: 'bg-red-100 text-red-700 border-red-200',    icon: '❌' },
  CANCELLED:   { label: 'ยกเลิก',  cls: 'bg-surface text-ink-muted border-surface-border',  icon: '↩️' },
};

// parent-05: the ETA endpoint answers 200 with { error } when there is nothing
// to show. Each code gets a Thai reason instead of a card of blank fields.
const ETA_ERROR_TH = {
  feature_disabled: 'ยังไม่เปิดใช้งานการคำนวณเวลาถึงโดยประมาณ (ETA)',
  no_vehicle: 'บุตรหลานยังไม่มีรถรับส่งประจำในระบบ',
  no_pickup_point: 'ยังไม่ได้กำหนดจุดรับ-ส่งของบุตรหลาน กรุณาติดต่อโรงเรียน',
  vehicle_offline: 'รถยังไม่ได้ส่งตำแหน่ง (อาจยังไม่เริ่มรอบ หรือออฟไลน์อยู่)',
};

// parent-04: a failed detail fetch used to look like "ยังไม่ส่ง" / "ไม่มีประวัติ".
// Turn the error into a Thai message the parent can act on.
function detailErrorMessage(err) {
  const code = err?.response?.status;
  if (!err?.response) return 'เชื่อมต่อระบบไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่';
  if (code === 401) return 'การยืนยันบัญชี LINE หมดอายุ กรุณาปิดแล้วเปิดหน้านี้ใหม่จาก LINE OA';
  if (code === 403) return 'ไม่มีสิทธิ์ดูข้อมูลของนักเรียนคนนี้';
  if (code === 429) return 'มีการใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่';
  if (code === 503) return 'LINE ยังไม่พร้อมยืนยันบัญชี กรุณาลองใหม่';
  return 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}

// M1 parent leave helpers (Bangkok calendar day; the server re-checks).
const LEAVE_SESSION_TH = { morning: 'รอบเช้า', evening: 'รอบเย็น', both: 'ทั้งวัน' };
const LEAVE_BY_TH = { me: 'ท่าน', parent: 'ผู้ปกครองอีกท่าน', driver: 'คนขับ', school: 'โรงเรียน' };
function todayBangkokStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}
function addDaysStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export default function ParentStatus() {
  const [idToken, setIdToken] = useState('');
  const [outsideLine, setOutsideLine] = useState(false);
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [eta, setEta] = useState(null);
  const [view, setView] = useState('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // The API tells us whether this parent still owes consent before the
  // tracking fields are shown. Absent on an older backend, in which case
  // nothing is prompted and behaviour is unchanged.
  const [consentRequired, setConsentRequired] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  // Per-view fetch state for status / history / ETA (parent-04).
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  // M1 parent leave via LINE — shown only when the backend reports it is on.
  const [leaveEnabled, setLeaveEnabled] = useState(false);
  const [leaves, setLeaves] = useState([]);
  const [leaveRules, setLeaveRules] = useState(null);
  const [leaveForm, setLeaveForm] = useState({ leave_date: '', session: 'both', reason: '' });
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveMsg, setLeaveMsg] = useState({ ok: '', err: '' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Identity comes from the verified LIFF id_token — never a query param.
      const token = await getLiffIdToken();
      if (cancelled) return;
      setIdToken(token);
      setOutsideLine(isOutsideLineClient());
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
        if (!cancelled) {
          setChildren(Array.isArray(res.data?.data) ? res.data.data : []);
          setConsentRequired(res.data?.meta?.consent_required === true);
          setLeaveEnabled(res.data?.meta?.parent_leave_enabled === true);
        }
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

  // Shared fetch for the three detail views: shows a spinner while loading and
  // an error card (not the empty state) when the request fails.
  async function loadDetail(child, nextView, path, onData) {
    setSelectedChild(child);
    setView(nextView);
    setDetailLoading(true);
    setDetailError('');
    try {
      const res = await axios.get(`/api/parent/children/${child.id}/${path}`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      onData(res.data?.data);
    } catch (err) {
      onData(undefined);
      const consentNeeded = err?.response?.status === 403
        && (err.response.data?.errors || []).some((e) => e?.code === 'PARENT_CONSENT_REQUIRED');
      if (consentNeeded) {
        setDetailError('ต้องให้ความยินยอมก่อนดูข้อมูลการเดินทางของบุตรหลาน');
        setShowConsent(true);
      } else {
        setDetailError(detailErrorMessage(err));
      }
    } finally {
      setDetailLoading(false);
    }
  }

  function viewStatus(child) {
    setStatus(null);
    return loadDetail(child, 'status', 'status', (d) => setStatus(d || null));
  }

  function viewHistory(child) {
    setHistory([]);
    return loadDetail(child, 'history', 'history?days=7', (d) => setHistory(d?.history || []));
  }

  function viewEta(child) {
    setEta(null);
    return loadDetail(child, 'eta', 'eta', (d) => setEta(d || null));
  }

  function viewLeave(child) {
    setLeaves([]);
    setLeaveMsg({ ok: '', err: '' });
    setLeaveForm({ leave_date: todayBangkokStr(), session: 'both', reason: '' });
    return loadDetail(child, 'leave', 'leaves', (d) => {
      setLeaves(d?.leaves || []);
      setLeaveRules(d?.rules || null);
    });
  }

  async function reloadLeaves(child) {
    const res = await axios.get(`/api/parent/children/${child.id}/leaves`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    setLeaves(res.data?.data?.leaves || []);
  }

  async function submitLeave() {
    if (!selectedChild || leaveBusy) return;
    setLeaveBusy(true);
    setLeaveMsg({ ok: '', err: '' });
    try {
      await axios.post(`/api/parent/children/${selectedChild.id}/leaves`, leaveForm, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      setLeaveMsg({ ok: 'แจ้งลาเรียบร้อยแล้ว คนขับและครูจะเห็นรายการนี้', err: '' });
      await reloadLeaves(selectedChild).catch(() => {});
    } catch (err) {
      setLeaveMsg({ ok: '', err: err.response?.data?.message || detailErrorMessage(err) });
    } finally {
      setLeaveBusy(false);
    }
  }

  async function cancelLeave(leaveId) {
    if (!selectedChild || leaveBusy) return;
    setLeaveBusy(true);
    setLeaveMsg({ ok: '', err: '' });
    try {
      await axios.post(`/api/parent/leaves/${leaveId}/cancel`, {}, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      setLeaveMsg({ ok: 'ยกเลิกการแจ้งลาแล้ว', err: '' });
      await reloadLeaves(selectedChild).catch(() => {});
    } catch (err) {
      setLeaveMsg({ ok: '', err: err.response?.data?.message || detailErrorMessage(err) });
    } finally {
      setLeaveBusy(false);
    }
  }

  function retryDetail() {
    if (!selectedChild) return;
    if (view === 'leave') { viewLeave(selectedChild); return; }
    if (view === 'status') viewStatus(selectedChild);
    else if (view === 'history') viewHistory(selectedChild);
    else if (view === 'eta') viewEta(selectedChild);
  }

  function goBack() {
    setView('list');
    setSelectedChild(null);
    setStatus(null);
    setHistory([]);
    setEta(null);
    setDetailError('');
    setDetailLoading(false);
  }

  // ── Opened outside LINE (parent-02): linked or not, we cannot tell without a
  // LINE identity, so ask to reopen in LINE rather than claim "not linked". ──
  if (!loading && !idToken && outsideLine) {
    return <OpenInLineCard subPath="" />;
  }

  // ── Unlinked state (inside LINE but no LIFF id_token) ──
  if (!loading && !idToken) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <AppCard padding="lg" className="max-w-sm w-full text-center">
          <Link2 className="w-12 h-12 mx-auto mb-4 text-brand-700" strokeWidth={1.6} aria-hidden="true" />
          <h1 className="text-xl font-semibold text-ink mb-3">ยังไม่ได้ผูกบัญชี LINE</h1>
          <p className="text-base text-ink-muted mb-6">ทำตามขั้นตอนด้านล่าง เพื่อดูสถานะรับ-ส่งบุตรหลาน</p>

          <div className="text-left space-y-4 mb-6">
            <StepItem number="1" text={<>เพิ่มเพื่อน LINE OA{' '}
              <a href={LINE_OA_URL} className="focus-ring inline-flex items-center min-h-[44px] px-1 text-brand-700 font-semibold underline" target="_blank" rel="noopener noreferrer">{LINE_OA_ID}</a>
              {' '}(รถรับส่งนักเรียน)</>} />
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
          <p className="text-base text-danger-ink font-medium mb-4">{error}</p>
          <button type="button" onClick={() => window.location.reload()}
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
          <Users className="w-12 h-12 mx-auto mb-4 text-ink-muted" strokeWidth={1.6} aria-hidden="true" />
          <h1 className="text-xl font-semibold text-ink mb-3">ไม่พบข้อมูลบุตรหลาน</h1>
          <p className="text-base text-ink-muted mb-2">
            บัญชี LINE ของคุณยังไม่ได้ผูกกับนักเรียน
          </p>
          <p className="text-base text-warn-ink font-medium mb-6">
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
            <button
              type="button"
              onClick={goBack}
              className="focus-ring-inverse inline-flex items-center justify-center bg-white/15 hover:bg-white/25 active:bg-white/30 font-semibold text-base px-5 min-h-[44px] rounded-xl transition"
            >
              กลับ
            </button>
          ) : (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="focus-ring-inverse inline-flex items-center justify-center bg-white/15 hover:bg-white/25 active:bg-white/30 text-sm px-4 min-h-[44px] rounded-xl transition"
            >
              รีเฟรช
            </button>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 pb-8">
        {/* ── Children list ── */}
        {view === 'list' && (
          <div className="space-y-4">
            {/* The parent is linked and school-approved, so the question is not
                "is this your child" but "may we show you the vehicle and
                driver". Ask it here rather than letting a 403 appear later
                with no way to act on it. */}
            {consentRequired && (
              <AppCard padding="md" className="border-warn/40 bg-warn-soft">
                <p className="text-base font-semibold text-ink">ต้องให้ความยินยอมก่อนดูข้อมูลการเดินทาง</p>
                <p className="text-sm text-ink-muted mt-1">
                  ระบบจะแสดงทะเบียนรถ ชื่อคนขับ และสถานะการรับ-ส่งของบุตรหลาน เมื่อคุณให้ความยินยอมแล้ว
                  คุณถอนความยินยอมได้ทุกเมื่อ
                </p>
                <button
                  type="button"
                  onClick={() => setShowConsent(true)}
                  className="focus-ring mt-3 inline-flex items-center justify-center bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-semibold text-base px-5 min-h-[44px] rounded-xl transition"
                >
                  อ่านและให้ความยินยอม
                </button>
              </AppCard>
            )}
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
                    {formatGradeClass(child.grade, child.classroom)}
                    {child.school_name && (
                      <span className="text-ink-muted"> · {child.school_name}</span>
                    )}
                  </p>
                  {child.plate_no && (
                    <p className="text-sm text-brand-600 font-medium mt-1.5">
                      <Bus className="w-4 h-4 inline align-[-3px] mr-1" strokeWidth={2} aria-hidden="true" />
                      {child.plate_no}
                      {child.driver_name && <span className="text-ink-muted font-normal"> · {child.driver_name}</span>}
                    </p>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 px-4 pb-4">
                  <button onClick={() => viewStatus(child)}
                    className="focus-ring flex-1 inline-flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-semibold min-h-[48px] rounded-xl transition text-base">
                    <ClipboardList className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                    สถานะวันนี้
                  </button>
                  <button onClick={() => viewEta(child)}
                    className="focus-ring flex-1 inline-flex items-center justify-center gap-1.5 bg-warn-soft hover:bg-warn-soft/70 text-warn-ink font-semibold min-h-[48px] rounded-xl transition border border-warn/30 text-base">
                    <MapPin className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                    ETA
                  </button>
                  <button onClick={() => viewHistory(child)}
                    className="focus-ring flex-1 inline-flex items-center justify-center gap-1.5 bg-brand-50 hover:bg-brand-100 active:bg-brand-200 text-brand-700 font-semibold min-h-[48px] rounded-xl transition border border-brand-200 text-base">
                    <CalendarDays className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                    ย้อนหลัง
                  </button>
                </div>
                {leaveEnabled && (
                  <div className="px-4 pb-4 -mt-2">
                    <button onClick={() => viewLeave(child)}
                      className="focus-ring w-full inline-flex items-center justify-center gap-1.5 bg-surface hover:bg-surface-raised text-ink font-semibold min-h-[48px] rounded-xl transition border border-surface-border text-base">
                      <CalendarDays className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                      แจ้งลา / ไม่ขึ้นรถ
                    </button>
                  </div>
                )}
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
                {formatGradeClass(selectedChild.grade, selectedChild.classroom)}
                {selectedChild.school_name && ` · ${selectedChild.school_name}`}
              </p>
            </AppCard>

            <p className="text-base font-semibold text-ink-muted">สถานะวันนี้</p>

            {detailLoading || detailError ? (
              <DetailState loading={detailLoading} error={detailError} onRetry={retryDetail} />
            ) : (<>
            {/* Morning / Evening cards */}
            <div className="grid grid-cols-2 gap-3">
              <StatusCard
                label="ส่งเช้า"
                icon={Sunrise}
                done={status?.morning_done}
                time={status?.morning_ts}
                doneText={status?.morning_label || 'ส่งถึงแล้ว'}
                pendingText={status?.morning_exception ? (status.morning_exception === 'SELF' ? 'มาเอง' : 'ลา') : 'ยังไม่ส่ง'}
              />
              <StatusCard
                label="รับเย็น"
                icon={Sunset}
                done={status?.evening_done}
                time={status?.evening_ts}
                doneText={status?.evening_label || 'รับแล้ว'}
                pendingText={status?.evening_exception ? (status.evening_exception === 'SELF' ? 'กลับเอง' : 'ลา') : 'ยังไม่รับ'}
              />
            </div>

            {!status?.morning_done && !status?.evening_done && !status?.morning_exception && !status?.evening_exception && (
              <p className="text-sm text-ink-muted text-center bg-surface rounded-xl py-3">
                ยังไม่มีข้อมูลเช็คอินวันนี้
              </p>
            )}
            </>)}

            {/* Quick action */}
            <button onClick={() => viewStatus(selectedChild)}
              className="w-full bg-surface hover:bg-surface-border text-ink-muted font-medium py-3 rounded-xl transition text-base">
              รีเฟรชสถานะ
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

            {detailLoading || detailError ? (
              <DetailState loading={detailLoading} error={detailError} onRetry={retryDetail} />
            ) : history.length === 0 ? (
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
                          {h.session === 'morning' ? 'ส่งเช้า' : 'รับเย็น'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`inline-block text-sm font-semibold px-3 py-1 rounded-full border ${st.cls}`}>
                          {/* The label carries the state; the emoji is
                               decoration and should not be announced. */}
                          <span aria-hidden="true">{st.icon}</span> {st.label}
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

        {/* ── Parent leave (M1) ── */}
        {view === 'leave' && selectedChild && (
          <div className="space-y-4">
            <AppCard padding="md">
              <p className="text-lg font-semibold text-ink">
                {selectedChild.first_name} {selectedChild.last_name}
              </p>
              <p className="text-base text-ink-muted">{selectedChild.school_name || '-'}</p>
            </AppCard>

            {detailLoading || detailError ? (
              <DetailState loading={detailLoading} error={detailError} onRetry={retryDetail} />
            ) : (
              <>
                <AppCard padding="md" className="space-y-3">
                  <p className="text-base font-semibold text-ink">แจ้งว่าบุตรหลานจะไม่ขึ้นรถ</p>
                  <label className="block text-sm text-ink-muted">วันที่
                    <input type="date" value={leaveForm.leave_date}
                      min={todayBangkokStr()} max={addDaysStr(todayBangkokStr(), leaveRules?.max_days_ahead ?? 14)}
                      onChange={(e) => setLeaveForm({ ...leaveForm, leave_date: e.target.value })}
                      className="focus-ring mt-1 w-full border border-surface-border bg-surface-raised rounded-lg px-3 min-h-[48px] text-base text-ink" />
                  </label>
                  <label className="block text-sm text-ink-muted">รอบ
                    <select value={leaveForm.session}
                      onChange={(e) => setLeaveForm({ ...leaveForm, session: e.target.value })}
                      className="focus-ring mt-1 w-full border border-surface-border bg-surface-raised rounded-lg px-3 min-h-[48px] text-base text-ink">
                      <option value="both">ทั้งวัน (เช้าและเย็น)</option>
                      <option value="morning">รอบเช้า</option>
                      <option value="evening">รอบเย็น</option>
                    </select>
                  </label>
                  <label className="block text-sm text-ink-muted">เหตุผล (ไม่บังคับ)
                    <input type="text" maxLength={255} value={leaveForm.reason}
                      onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                      placeholder="เช่น ไม่สบาย, ผู้ปกครองรับเอง"
                      className="focus-ring mt-1 w-full border border-surface-border bg-surface-raised rounded-lg px-3 min-h-[48px] text-base text-ink" />
                  </label>
                  {leaveRules && (
                    <p className="text-sm text-ink-muted">
                      แจ้งของวันนี้ได้ก่อน {leaveRules.morning_cutoff} น. (รอบเช้า/ทั้งวัน) และก่อน {leaveRules.evening_cutoff} น. (รอบเย็น) ล่วงหน้าได้ไม่เกิน {leaveRules.max_days_ahead} วัน
                    </p>
                  )}
                  {leaveMsg.err && <p className="text-danger-ink text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{leaveMsg.err}</p>}
                  {leaveMsg.ok && <p className="text-success-ink text-sm bg-success-soft border border-success/30 rounded-lg px-3 py-2">{leaveMsg.ok}</p>}
                  <button type="button" onClick={submitLeave} disabled={leaveBusy || !leaveForm.leave_date}
                    className="focus-ring w-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-semibold min-h-[48px] rounded-xl transition text-base">
                    {leaveBusy ? 'กำลังส่ง…' : 'ส่งแจ้งลา'}
                  </button>
                </AppCard>

                <p className="text-base font-semibold text-ink-muted">รายการลาที่จะถึง</p>
                {leaves.length === 0 ? (
                  <AppCard padding="lg" className="text-center">
                    <p className="text-ink-muted text-lg">ยังไม่มีรายการลา</p>
                  </AppCard>
                ) : (
                  <div className="space-y-2">
                    {leaves.map((l) => (
                      <AppCard key={l.id} padding="sm" className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-base font-medium text-ink">
                            {new Date(`${l.leave_date}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })}
                            {' · '}{LEAVE_SESSION_TH[l.session] || l.session}
                          </p>
                          <p className="text-sm text-ink-muted">
                            {l.kind === 'SELF' ? 'เดินทางเอง' : 'ลา'} · แจ้งโดย{LEAVE_BY_TH[l.reported_by] || l.reported_by}
                            {l.reason ? ` · ${l.reason}` : ''}
                          </p>
                        </div>
                        {l.can_cancel && (
                          <button type="button" onClick={() => cancelLeave(l.id)} disabled={leaveBusy}
                            className="focus-ring shrink-0 min-h-[44px] px-3 rounded-lg border border-surface-border text-ink hover:bg-surface text-sm font-semibold disabled:opacity-50">
                            ยกเลิก
                          </button>
                        )}
                      </AppCard>
                    ))}
                  </div>
                )}
              </>
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

            {detailLoading || detailError ? (
              <DetailState loading={detailLoading} error={detailError} onRetry={retryDetail} />
            ) : eta?.error ? (
              <AppCard padding="lg" className="text-center">
                <MapPin className="w-10 h-10 mx-auto mb-2 text-ink-muted" strokeWidth={1.8} aria-hidden="true" />
                <p className="text-ink-muted text-base">
                  {ETA_ERROR_TH[eta.error] || 'ยังไม่มีข้อมูล ETA'}
                </p>
                {eta.error === 'vehicle_offline' && (
                  <button
                    type="button"
                    onClick={() => viewEta(selectedChild)}
                    className="focus-ring mt-4 inline-flex items-center justify-center bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold px-6 min-h-[44px] rounded-xl border-2 border-amber-200 transition"
                  >
                    รีเฟรช ETA
                  </button>
                )}
              </AppCard>
            ) : eta == null ? (
              <AppCard padding="lg" className="text-center">
                <MapPin className="w-10 h-10 mx-auto mb-2 text-ink-muted" strokeWidth={1.8} aria-hidden="true" />
                <p className="text-ink-muted text-base">
                  ยังไม่มีข้อมูล ETA — รถอาจออฟไลน์ หรือยังไม่เริ่มรอบ
                </p>
                <p className="text-sm text-ink-muted mt-2">
                  ลองกดรีเฟรชอีกครั้งเมื่อรถเริ่มวิ่ง
                </p>
              </AppCard>
            ) : (
              <AppCard padding="lg" className="text-center">
                <Bus className="w-12 h-12 mx-auto mb-3 text-ink-muted" strokeWidth={1.6} aria-hidden="true" />
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
                  <p className="text-sm text-warn-ink mt-1">
                    ระยะทาง {eta.distance_meters != null ? `${(eta.distance_meters / 1000).toFixed(1)} กม.` : 'ไม่ทราบ'}
                  </p>
                  <p className="text-xs text-warn-ink mt-1">
                    ความมั่นใจ: {eta.confidence === 'HIGH' ? 'สูง' : eta.confidence === 'MEDIUM' ? 'ปานกลาง' : eta.confidence === 'LOW' ? 'ต่ำ' : 'ไม่ทราบ'}
                  </p>
                </div>
                <p className="text-xs text-ink-muted mt-3">
                  อัปเดต {eta.age_seconds != null ? `${eta.age_seconds}s ที่แล้ว` : '-'}
                </p>
                <button
                  type="button"
                  onClick={() => viewEta(selectedChild)}
                  className="focus-ring mt-4 inline-flex items-center justify-center bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold px-6 min-h-[44px] rounded-xl border-2 border-amber-200 transition"
                >
                  รีเฟรช ETA
                </button>
              </AppCard>
            )}
          </div>
        )}
      </div>

      {/* Consent is collected in the same place the restriction is felt, so a
          parent never has to find another screen to unblock themselves. */}
      {showConsent && (
        <ParentConsentModal
          idToken={idToken}
          onConsented={() => { setShowConsent(false); window.location.reload(); }}
          onClose={() => setShowConsent(false)}
        />
      )}
    </div>
  );
}

/* ── Loading / error state for a detail view (parent-04) ── */
function DetailState({ loading, error, onRetry }) {
  if (loading) {
    return (
      <AppCard padding="lg" className="text-center" role="status">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600 mx-auto mb-3" aria-hidden="true" />
        <p className="text-ink-muted text-base">กำลังโหลดข้อมูล…</p>
      </AppCard>
    );
  }
  return (
    <AppCard padding="lg" className="text-center border-danger/30" role="alert">
      <p className="text-base text-danger-ink font-medium mb-4">{error}</p>
      <button type="button" onClick={onRetry}
        className="focus-ring bg-red-50 hover:bg-red-100 text-red-700 font-medium px-6 min-h-[44px] rounded-xl transition border border-red-200">
        ลองใหม่อีกครั้ง
      </button>
    </AppCard>
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
/**
 * The done/pending state was a 3xl ✅ or ⏳ above the label — the emoji WAS the
 * status, so a parent using a screen reader got nothing, and the session icon
 * (🌅 / 🌆) sat inside the label text. Both are Lucide icons now, aria-hidden,
 * with the existing doneText / pendingText carrying the meaning.
 */
function StatusCard({ label, icon: SessionIcon, done, time, doneText, pendingText }) {
  const timeStr = time ? new Date(time).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : null;
  const StateIcon = done ? CheckCircle2 : Clock;

  return (
    <div className={`rounded-2xl border-2 p-4 text-center ${done ? 'bg-success-soft border-success/40' : 'bg-surface border-surface-border'}`}>
      <StateIcon
        className={`w-8 h-8 mx-auto mb-2 ${done ? 'text-success-ink' : 'text-ink-muted'}`}
        strokeWidth={2}
        aria-hidden="true"
      />
      <p className="text-base font-semibold text-ink inline-flex items-center justify-center gap-1.5">
        {SessionIcon && <SessionIcon className="w-4 h-4 text-ink-muted" strokeWidth={2} aria-hidden="true" />}
        {label}
      </p>
      <p className={`text-sm font-medium mt-1 ${done ? 'text-success-ink' : 'text-ink-muted'}`}>
        {done ? doneText : pendingText}
      </p>
      {done && timeStr && (
        <p className="text-lg font-semibold text-success-ink mt-1 tabular-nums">{timeStr} น.</p>
      )}
    </div>
  );
}
