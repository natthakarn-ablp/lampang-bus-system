import { useEffect, useState } from 'react';
import api from '../../api/axios';
import { useToast } from '../Toast';

// Phase QR-1 — driver consent management. THREE SEPARATE consent records
// (public / parent / sensitive), each granted/withdrawn independently. Each
// checkbox is NOT pre-checked. Withdrawing a required consent warns that the
// public display becomes "ระงับการแสดงผล".
const DRIVER_CONSENTS = [
  { type: 'qr_driver_public', label: 'แสดงสถานะระดับสาธารณะ', required: true },
  { type: 'qr_driver_parent', label: 'แสดงชื่อ/ช่องทางติดต่อแก่ผู้ปกครอง', required: true },
  { type: 'qr_driver_sensitive', label: 'ข้อมูลอ่อนไหวต่อเจ้าหน้าที่ (PDPA ม.26)', required: false },
];

export default function DriverConsentForm() {
  const toast = useToast();
  const [statuses, setStatuses] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  async function load() {
    try {
      const res = await api.get('/consent/me');
      const map = {};
      (res.data.data || []).forEach((c) => { map[c.type] = c.status; });
      setStatuses(map);
    } catch { toast.error('โหลดสถานะความยินยอมไม่สำเร็จ'); }
  }

  async function grant(type) {
    setBusy(true);
    try { await api.post('/consent', { consent_type: type }); toast.success('บันทึกความยินยอมแล้ว'); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'ไม่สำเร็จ'); } finally { setBusy(false); }
  }
  async function withdraw(type, required) {
    if (required && !window.confirm('การถอนความยินยอมที่จำเป็นจะทำให้ระบบ "ระงับการแสดงผล" ของคุณ ยืนยันหรือไม่?')) return;
    setBusy(true);
    try { await api.post('/consent/withdraw', { consent_type: type }); toast.success('ถอนความยินยอมแล้ว'); load(); }
    catch (err) { toast.error(err.response?.data?.message || 'ไม่สำเร็จ'); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-md">
      <h2 className="text-base font-semibold text-gray-800 mb-1">การจัดการความยินยอม (QR)</h2>
      <p className="text-xs text-gray-400 mb-4">เลือกยินยอมแยกแต่ละรายการ ถอนได้ตลอดเวลา</p>
      <div className="space-y-2">
        {DRIVER_CONSENTS.map((c) => {
          const granted = statuses[c.type] === 'granted';
          return (
            <div key={c.type} className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2.5">
              <div>
                <div className="text-sm text-gray-700">{c.label}{c.required && <span className="text-red-500 ml-1">*</span>}</div>
                <div className={`text-xs mt-0.5 ${granted ? 'text-emerald-600' : 'text-gray-400'}`}>{granted ? 'ยินยอมแล้ว' : 'ยังไม่ยินยอม'}</div>
              </div>
              {granted
                ? <button onClick={() => withdraw(c.type, c.required)} disabled={busy} className="text-xs text-red-600 hover:text-red-800 border border-red-200 rounded-lg px-3 py-1.5">ถอน</button>
                : <button onClick={() => grant(c.type)} disabled={busy} className="text-xs text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-1.5">ยินยอม</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
