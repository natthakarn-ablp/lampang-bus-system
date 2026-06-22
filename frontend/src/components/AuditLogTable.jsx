import { useState, useEffect, useCallback } from 'react';
import api from '../api/axios';
import AuditEntry from './AuditEntry';
import EmptyState from './EmptyState';
import Pagination from './Pagination';
import { ClipboardList } from 'lucide-react';

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
      setLogs(Array.isArray(res?.data?.data) ? res.data.data : []);
      setMeta(res?.data?.meta || { page: 1, per_page: 30, total: 0 });
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
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-800 mb-4">{title}</h1>

      {/* Filter bar */}
      <div className="space-y-3 sm:space-y-0 sm:flex sm:flex-wrap sm:items-end sm:gap-3 mb-4">
        <div className="flex gap-2 flex-wrap">
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs text-gray-500 mb-1">การกระทำ</label>
            <select value={action} onChange={(e) => setAction(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
              {ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs text-gray-500 mb-1">ตั้งแต่</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-xs text-gray-500 mb-1">ถึง</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
        </div>
        <div className="flex gap-2">
          {hasFilters && (
            <button onClick={clearFilters}
              className="text-sm text-gray-500 hover:text-red-600 px-4 py-2.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
              ล้างตัวกรอง
            </button>
          )}
          <button onClick={handleExportCsv}
            className="text-sm text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 px-4 py-2.5 rounded-lg transition sm:ml-auto">
            Export CSV
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={hasFilters ? 'ไม่พบรายการตามตัวกรอง' : 'ยังไม่มีประวัติ'}
          description={hasFilters ? 'ลองเปลี่ยนตัวกรองหรือล้างเพื่อดูทั้งหมด' : null}
        />
      ) : (
        <>
          <div className="space-y-2">
            {logs.map(l => (
              <AuditEntry
                key={l.id}
                timestamp={l.created_at}
                actor={l.actor_name}
                action={l.action}
                entityType={l.entity_type}
                entityId={l.entity_id}
                summary={summarize(l)}
              />
            ))}
          </div>

          <Pagination page={meta.page} totalPages={totalPages} total={meta.total} shown={logs.length} onPage={(p) => fetchLogs(p)} />
        </>
      )}
    </div>
  );
}
