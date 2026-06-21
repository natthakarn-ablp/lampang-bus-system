import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios'; // raw axios — public page, no JWT auth
import { getLiffIdToken } from '../../utils/liff';
import ParentConsentModal from '../../components/consent/ParentConsentModal';
import PublicPrivacyNotice from '../../components/consent/PublicPrivacyNotice';

// Phase QR-1 — public vehicle QR page. Renders Level-1 (anyone), then
// progressively escalates to Level-2 if opened inside LINE by a verified parent
// linked to this vehicle (after parent opt-in). The level is decided by the
// server; the client only renders whatever fields it receives.

const INSPECTION = {
  PASSED: { label: 'ผ่านการตรวจสภาพ', tone: 'emerald' },
  FAILED: { label: 'ไม่ผ่านการตรวจสภาพ', tone: 'red' },
  NEEDS_FIX: { label: 'ต้องแก้ไข', tone: 'amber' },
  PENDING: { label: 'รอตรวจสภาพ', tone: 'slate' },
};
const INSURANCE = {
  active: { label: 'มีประกันภัย', tone: 'emerald' },
  expired: { label: 'ประกันภัยหมดอายุ', tone: 'amber' },
  none: { label: 'ไม่มีประกันภัย', tone: 'red' },
};
const DRIVER = {
  normal: { label: 'ปกติ', tone: 'emerald' },
  suspended: { label: 'ระงับการแสดงผล', tone: 'red' },
  no_driver: { label: 'ยังไม่มีคนขับ', tone: 'slate' },
};
const TONE = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  slate: 'bg-slate-50 text-slate-600 border-slate-200',
};

function Badge({ map, value }) {
  const m = (map && map[value]) || { label: value || '—', tone: 'slate' };
  return <span className={`text-sm px-3 py-1 rounded-full border ${TONE[m.tone]}`}>{m.label}</span>;
}
function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span>{children}</span>
    </div>
  );
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
      const optedIn = (me.data.data || []).some((c) => c.type === 'qr_parent_optin' && c.status === 'granted');
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

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400">กำลังโหลด…</div>;
  if (error) return <div className="min-h-screen flex items-center justify-center text-gray-500 p-6 text-center">{error}</div>;
  if (!data) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-lg font-semibold text-gray-800">ข้อมูลรถรับส่งนักเรียน</h1>
            <button onClick={() => setShowNotice(true)} className="text-xs text-blue-600 hover:text-blue-800 underline">ความเป็นส่วนตัว</button>
          </div>
          <p className="text-2xl font-bold text-gray-900 tabular-nums mb-4">{data.plate_no}</p>

          <div className="space-y-0">
            {data.vehicle_type && <Row label="ประเภทรถ"><span className="text-sm text-gray-700">{data.vehicle_type}</span></Row>}
            <Row label="สถานะตรวจสภาพ"><Badge map={INSPECTION} value={data.inspection_status} /></Row>
            <Row label="สถานะประกันภัย"><Badge map={INSURANCE} value={data.insurance_status} /></Row>
            <Row label="สถานะคนขับ"><Badge map={DRIVER} value={data.driver_status} /></Row>

            {data.level >= 2 && (
              <>
                <Row label="ชื่อคนขับ"><span className="text-sm font-medium text-gray-800">{data.driver_name || '—'}</span></Row>
                <Row label="ติดต่อฉุกเฉิน">
                  {data.emergency_contact
                    ? <a href={`tel:${data.emergency_contact}`} className="text-sm font-medium text-blue-600">{data.emergency_contact}</a>
                    : <span className="text-sm text-gray-400">—</span>}
                </Row>
              </>
            )}
          </div>

          {data.level === 1 && (
            <p className="text-xs text-gray-400 mt-4">เปิดผ่าน LINE และผูกบัญชีผู้ปกครองเพื่อดูชื่อคนขับและช่องทางติดต่อ</p>
          )}
        </div>
      </div>

      {showNotice && <PublicPrivacyNotice onClose={() => setShowNotice(false)} />}
      {showParentConsent && <ParentConsentModal idToken={idToken} onConsented={onParentConsented} onClose={() => setShowParentConsent(false)} />}
    </div>
  );
}
