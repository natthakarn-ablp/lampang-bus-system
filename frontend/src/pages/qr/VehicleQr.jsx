import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios'; // raw axios — public page, no JWT auth
import { getLiffIdToken } from '../../utils/liff';
import ParentConsentModal from '../../components/consent/ParentConsentModal';
import PublicPrivacyNotice from '../../components/consent/PublicPrivacyNotice';
import { toBangkokDate } from '../../utils/thaiTime';

// Phase QR-1 — public vehicle QR page. Renders Level-1 (anyone), then
// progressively escalates to Level-2 if opened inside LINE by a verified parent
// linked to this vehicle (after parent opt-in). The level is decided by the
// server; the client only renders whatever fields it receives.

// Each status entry carries an icon (glyph) alongside the Thai label so colour is
// never the only signal — DESIGN.md "No Color-Only Status Rule".
const INSPECTION = {
  PASSED: { label: 'ผ่านการตรวจสภาพ', tone: 'emerald', icon: '✓' },
  FAILED: { label: 'ไม่ผ่านการตรวจสภาพ', tone: 'red', icon: '✕' },
  NEEDS_FIX: { label: 'ต้องแก้ไข', tone: 'amber', icon: '!' },
  PENDING: { label: 'รอตรวจสภาพ', tone: 'slate', icon: '…' },
};
// Shown when the inspection certificate has lapsed — never green even if PASSED.
// "Unknown is not safe": a stale certificate must read as expired, not current.
const INSPECTION_EXPIRED = { label: 'หมดอายุการตรวจสภาพ', tone: 'red', icon: '⚠' };
const INSURANCE = {
  active: { label: 'มีประกันภัย', tone: 'emerald', icon: '✓' },
  expired: { label: 'ประกันภัยหมดอายุ', tone: 'amber', icon: '⚠' },
  none: { label: 'ไม่มีประกันภัย', tone: 'red', icon: '✕' },
};
const DRIVER = {
  normal: { label: 'ปกติ', tone: 'emerald', icon: '✓' },
  suspended: { label: 'ระงับการแสดงผล', tone: 'red', icon: '✕' },
  no_driver: { label: 'ยังไม่มีคนขับ', tone: 'slate', icon: '—' },
};
// vehicle.verification_status — UNVERIFIED must never read as green ("ผ่าน").
const ELIGIBILITY = {
  UNVERIFIED: { label: 'ยังไม่ได้รับรอง', tone: 'amber', icon: '?' },
  ELIGIBLE: { label: 'พร้อมใช้งาน', tone: 'emerald', icon: '✓' },
  EXPIRING: { label: 'ใกล้หมดอายุ', tone: 'amber', icon: '⚠' },
  INELIGIBLE: { label: 'ยังไม่ผ่านเกณฑ์', tone: 'red', icon: '✕' },
  SUSPENDED: { label: 'ถูกระงับใช้งาน', tone: 'red', icon: '✕' },
};
// Per-document certificate status. MISSING/unknown stays neutral, never green.
const DOCUMENT = {
  VALID: { label: 'ปกติ', tone: 'emerald', icon: '✓' },
  EXPIRING: { label: 'ใกล้หมดอายุ', tone: 'amber', icon: '⚠' },
  EXPIRED: { label: 'หมดอายุ', tone: 'red', icon: '✕' },
  MISSING: { label: 'ไม่มีข้อมูล', tone: 'slate', icon: '—' },
};
const DOCUMENT_LABELS = {
  insurance: 'ประกันภัย',
  registration: 'ทะเบียน',
  compulsory_insurance: 'พ.ร.บ.',
  tax: 'ภาษี',
};
const TONE = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  slate: 'bg-slate-50 text-slate-600 border-slate-200',
};

// Thai date (พ.ศ.). Returns null on missing/invalid input so callers can skip the row.
function formatThaiDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
  } catch {
    return toBangkokDate(d);
  }
}

function Badge({ map, value, entry }) {
  const m = entry || (map && map[value]) || { label: value || '—', tone: 'slate' };
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full border ${TONE[m.tone]}`}>
      {m.icon && <span aria-hidden="true" className="font-semibold leading-none">{m.icon}</span>}
      <span>{m.label}</span>
    </span>
  );
}
// Compact status chip used inside the document group (smaller than Badge).
function Chip({ label, entry }) {
  const m = entry || { label: '—', tone: 'slate' };
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border ${TONE[m.tone]}`}>
      {m.icon && <span aria-hidden="true" className="font-semibold leading-none">{m.icon}</span>}
      <span className="text-gray-600">{label}</span>
      <span>{m.label}</span>
    </span>
  );
}
function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span>{children}</span>
    </div>
  );
}
// Inspection badge must reflect BOTH status and certificate expiry. A PASSED
// inspection whose certificate has lapsed must NOT show green "ผ่าน".
function inspectionEntry(status, expired) {
  if (expired) return INSPECTION_EXPIRED;
  return INSPECTION[status] || { label: status || '—', tone: 'slate', icon: '?' };
}

export default function VehicleQr() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showNotice, setShowNotice] = useState(false);
  const [showParentConsent, setShowParentConsent] = useState(false);
  const [idToken, setIdToken] = useState('');

  useEffect(() => { loadPublic(); /* eslint-disable-next-line */ }, [token]);

  async function loadPublic() {
    setLoading(true); setError('');
    try {
      const res = await axios.get(`/api/qr/vehicle/${encodeURIComponent(token)}`);
      setData(res.data.data);
      tryEscalate();
    } catch (err) {
      setError(err.response?.status === 404 ? 'ไม่พบข้อมูลรถสำหรับ QR นี้' : 'ไม่สามารถโหลดข้อมูลได้');
    } finally { setLoading(false); }
  }

  // If opened inside LINE, check parent opt-in then fetch Level-2.
  async function tryEscalate() {
    let t = '';
    try { t = await getLiffIdToken(); } catch { t = ''; }
    if (!t) return;
    setIdToken(t);
    try {
      const me = await axios.get('/api/consent/me/parent', { headers: { Authorization: `Bearer ${t}` } });
      const optedIn = (Array.isArray(me.data?.data) ? me.data.data : []).some((c) => c.type === 'qr_parent_optin' && c.status === 'granted');
      if (optedIn) loadParent(t);
      else setShowParentConsent(true);
    } catch { /* not a linkable parent — stay at Level-1 */ }
  }

  async function loadParent(t) {
    try {
      const res = await axios.get(`/api/qr/vehicle/${encodeURIComponent(token)}`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.data.data?.level >= 2) setData(res.data.data);
    } catch { /* stay at current level */ }
  }

  async function onParentConsented() {
    setShowParentConsent(false);
    if (idToken) loadParent(idToken);
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-ink-muted">กำลังโหลด…</div>;
  if (error) return <div className="min-h-screen flex items-center justify-center text-ink-muted p-6 text-center">{error}</div>;
  if (!data) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-semibold text-gray-800">ข้อมูลรถรับส่งนักเรียน</h1>
            {/* 80x16 before: the hit box is now 44px tall via padding and a
                 matching negative margin, so the row keeps its original
                 height and the link keeps its inline appearance. */}
            <button
              type="button"
              onClick={() => setShowNotice(true)}
              className="focus-ring -my-3 -mr-2 inline-flex shrink-0 items-center min-h-[44px] px-2 rounded-lg text-xs text-blue-600 hover:text-blue-800 underline"
            >
              ความเป็นส่วนตัว
            </button>
          </div>
          <p className="text-2xl font-bold text-gray-900 tabular-nums mb-4">{data.plate_no}</p>

          {(() => {
            const lastInspection = formatThaiDate(data.last_inspection_date);
            const inspectionExpiry = formatThaiDate(data.inspection_expiry);
            const docStatus = data.document_status || {};
            const docKeys = Object.keys(DOCUMENT_LABELS).filter((k) => docStatus[k] != null);
            return (
          <div className="space-y-0">
            {data.vehicle_type && <Row label="ประเภทรถ"><span className="text-sm text-gray-700">{data.vehicle_type}</span></Row>}
            {data.eligibility_status != null && (
              <Row label="สถานะการรับรอง"><Badge map={ELIGIBILITY} value={data.eligibility_status} /></Row>
            )}
            <Row label="สถานะตรวจสภาพ">
              <Badge entry={inspectionEntry(data.inspection_status, data.inspection_expired)} />
            </Row>
            {lastInspection && (
              <Row label="ตรวจสภาพล่าสุด"><span className="text-sm text-gray-700 tabular-nums">{lastInspection}</span></Row>
            )}
            {inspectionExpiry && (
              <Row label="ตรวจสภาพหมดอายุ">
                <span className={`text-sm tabular-nums ${data.inspection_expired ? 'text-red-700 font-medium' : 'text-gray-700'}`}>{inspectionExpiry}</span>
              </Row>
            )}
            <Row label="สถานะประกันภัย"><Badge map={INSURANCE} value={data.insurance_status} /></Row>
            <Row label="สถานะคนขับ"><Badge map={DRIVER} value={data.driver_status} /></Row>

            {docKeys.length > 0 && (
              <div className="py-3 border-b border-gray-50 last:border-0">
                <span className="text-sm text-ink-muted">สถานะเอกสาร</span>
                <div className="flex flex-wrap gap-2 mt-2">
                  {docKeys.map((k) => (
                    <Chip key={k} label={DOCUMENT_LABELS[k]} entry={DOCUMENT[docStatus[k]] || DOCUMENT.MISSING} />
                  ))}
                </div>
              </div>
            )}

            {data.level >= 2 && (
              <>
                <Row label="ชื่อคนขับ"><span className="text-sm font-medium text-gray-800">{data.driver_name || '—'}</span></Row>
                <Row label="ติดต่อฉุกเฉิน">
                  {data.emergency_contact
                    ? <a
                        href={`tel:${data.emergency_contact}`}
                        className="focus-ring -my-3 inline-flex items-center min-h-[44px] px-2 -mr-2 rounded-lg text-sm font-medium text-blue-600"
                      >
                        {data.emergency_contact}
                      </a>
                    : <span className="text-sm text-ink-muted">—</span>}
                </Row>
              </>
            )}
          </div>
            );
          })()}

          {data.level === 1 && (
            <p className="text-xs text-ink-muted mt-4">เปิดผ่าน LINE และผูกบัญชีผู้ปกครองเพื่อดูชื่อคนขับและช่องทางติดต่อ</p>
          )}
        </div>
      </div>

      {showNotice && <PublicPrivacyNotice onClose={() => setShowNotice(false)} />}
      {showParentConsent && <ParentConsentModal idToken={idToken} onConsented={onParentConsented} onClose={() => setShowParentConsent(false)} />}
    </div>
  );
}
