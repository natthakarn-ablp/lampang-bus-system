import { useState, useEffect, useCallback } from 'react';
import api from '../api/axios';

const ACTION_OPTIONS = [
  { value: '', label: 'ทุกการกระทำ' },
  { value: 'CREATE', label: 'สร้าง' },
  { value: 'UPDATE', label: 'แก้ไข' },
  { value: 'DELETE', label: 'ลบ' },
  { value: 'IMPORT', label: 'นำเข้า' },
  { value: 'APPROVE', label: 'อนุมัติ' },
  { value: 'EXPORT', label: 'ส่งออก' },
  { value: 'LOGIN', label: 'เข้าสู่ระบบ' },
];

const ACTION_LABEL = {
  CREATE: 'สร้าง', UPDATE: 'แก้ไข', DELETE: 'ลบ',
  EXPORT: 'ส่งออก', LOGIN: 'เข้าสู่ระบบ', IMPORT: 'นำเข้า', APPROVE: 'อนุมัติ',
};

const ENTITY_LABEL = {
  student: 'นักเรียน', vehicle: 'รถรับส่ง', user: 'บัญชีผู้ใช้',
  roster_request: 'คำขอรายชื่อ', leave: 'การลา', checkin: 'เช็กอิน',
  driver: 'คนขับ', driver_profile: 'ข้อมูลคนขับ', emergency: 'เหตุฉุกเฉิน',
};

const FIELD_LABEL = {
  prefix: 'คำนำหน้า', first_name: 'ชื่อ', last_name: 'นามสกุล',
  grade: 'ชั้น', classroom: 'ห้อง', vehicle_id: 'รถ',
  morning_enabled: 'เช้า', evening_enabled: 'เย็น',
  parent_name: 'ผู้ปกครอง', parent_phone: 'เบอร์ผู้ปกครอง',
};

function summarize(row) {
  const nv = row.new_value ? (typeof row.new_value === 'string' ? JSON.parse(row.new_value) : row.new_value) : {};
  const ov = row.old_value ? (typeof row.old_value === 'string' ? JSON.parse(row.old_value) : row.old_value) : {};

  if (nv.action === 'move_vehicle') {
    const from = ov.plate_no || ov.vehicle_id || 'ไม่มีรถ';
    const to = nv.vehicle_id || 'ไม่มีรถ';
    return `ย้ายรถ: ${from} → ${to}`;
  }
  if (nv.action === 'withdraw') {
    const name = ov.student_name || nv.student_name || '';
    const info = [ov.grade, ov.classroom].filter(Boolean).join('/');
    const plate = ov.plate_no ? ` · รถ ${ov.plate_no}` : '';
    return `ลาออก: ${name}${info ? ` (${info})` : ''}${plate}`;
  }
  if (nv.action === 'password_reset') return 'รีเซ็ตรหัสผ่าน';
  if (row.action === 'IMPORT') return `นำเข้า ${nv.success || 0} รายการ (ผิด ${nv.errors || 0})`;
  if (row.action === 'APPROVE') return `${nv.status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ'} คำขอ${nv.requestType === 'add' ? 'เพิ่ม' : 'ถอน'}`;
  if (row.action === 'CREATE' && row.entity_type === 'user') return `สร้างบัญชี: ${nv.username || ''}`;
  if (row.action === 'CREATE' && row.entity_type === 'vehicle') return `เพิ่มรถ: ${nv.plate_no || ''}`;

  const fields = Object.keys(nv).filter(k => k !== 'action');
  if (fields.length > 0 && Object.keys(ov).length > 0 && fields.length <= 3) {
    return fields.map(k => `${FIELD_LABEL[k] || k}: ${ov[k] ?? '-'} → ${nv[k] ?? '-'}`).join(' · ');
  }
  if (fields.length > 0 && fields.length <= 5) return `แก้ไข: ${fields.map(k => FIELD_LABEL[k] || k).join(', ')}`;
  if (fields.length > 5) return `แก้ไข ${fields.length} รายการ`;
  return '-';
}

const ACTION_CLASS = {
  CREATE: 'bg-green-100 text-green-700',
  UPDATE: 'bg-blue-100 text-blue-700',
  DELETE: 'bg-red-100 text-red-700',
  APPROVE: 'bg-purple-100 text-purple-700',
  IMPORT: 'bg-amber-100 text-amber-700',
};

export default function AuditLogTable({ apiPath, title = 'ประวัติการแก้ไข' }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ page: 1, per_page: 30, total: 0 });

  // Filters
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchLogs = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('per_page', '30');
      if (action) params.set('action', action);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);

      const res = await api.get(`${apiPath}?${params}`);
      setLogs(res.data.data);
      setMeta(res.data.meta);
    } catch {} finally { setLoading(false); }
  }, [apiPath, action, dateFrom, dateTo]);

  useEffect(() => { fetchLogs(1); }, [fetchLogs]);

  function clearFilters() {
    setAction('');
    setDateFrom('');
    setDateTo('');
  }

  async function handleExportCsv() {
    try {
      const params = new URLSearchParams();
      params.set('format', 'csv');
      if (action) params.set('action', action);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);

      const res = await api.get(`${apiPath}?${params}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently fail or could add toast
    }
  }

  const hasFilters = action || dateFrom || dateTo;
  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-4">{title}</h1>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">การกระทำ</label>
          <select value={action} onChange={(e) => setAction(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
            {ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">ตั้งแต่วันที่</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">ถึงวันที่</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        {hasFilters && (
          <button onClick={clearFilters}
            className="text-xs text-gray-500 hover:text-red-600 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
            ล้างตัวกรอง
          </button>
        )}
        <button onClick={handleExportCsv}
          className="text-xs text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 px-3 py-2 rounded-lg transition ml-auto">
          Export CSV
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : logs.length === 0 ? (
        <p className="text-gray-400 py-10 text-center">{hasFilters ? 'ไม่พบรายการตามตัวกรอง' : 'ยังไม่มีประวัติ'}</p>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-4 py-3 font-medium">วันเวลา</th>
                  <th className="px-4 py-3 font-medium">ผู้ดำเนินการ</th>
                  <th className="px-4 py-3 font-medium">การกระทำ</th>
                  <th className="px-4 py-3 font-medium">ประเภท</th>
                  <th className="px-4 py-3 font-medium">รหัส</th>
                  <th className="px-4 py-3 font-medium">รายละเอียด</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map(l => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(l.created_at).toLocaleString('th-TH', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs">{l.actor_name || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ACTION_CLASS[l.action] || 'bg-gray-100 text-gray-600'}`}>
                        {ACTION_LABEL[l.action] || l.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{ENTITY_LABEL[l.entity_type] || l.entity_type || '-'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{l.entity_id || '-'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{summarize(l)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
            <span>แสดง {logs.length} จาก {meta.total} รายการ</span>
            <div className="flex gap-2">
              <button onClick={() => fetchLogs(meta.page - 1)} disabled={meta.page <= 1}
                className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30">ก่อนหน้า</button>
              <span className="px-3 py-1">หน้า {meta.page}/{totalPages}</span>
              <button onClick={() => fetchLogs(meta.page + 1)} disabled={meta.page >= totalPages}
                className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30">ถัดไป</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
