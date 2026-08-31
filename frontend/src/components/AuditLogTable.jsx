import { useState, useEffect, useCallback } from 'react';
import api from '../api/axios';
import AuditEntry from './AuditEntry';
import EmptyState from './EmptyState';
import LoadingState from './LoadingState';
import Pagination from './Pagination';
import PageHeader from './PageHeader';
import { FilterBar } from './ui';
import { ClipboardList, Download } from 'lucide-react';
import { abbreviateGrade, formatGradeClass } from '../utils/student';

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
    const info = formatGradeClass(ov.grade, ov.classroom, '');
    const plate = ov.plate_no ? ` · รถ ${ov.plate_no}` : '';
    return `ลาออก: ${name}${info ? ` (${info})` : ''}${plate}`;
  }
  if (nv.action === 'password_reset') return 'รีเซ็ตรหัสผ่าน';
  if (row.action === 'IMPORT') return `นำเข้า ${nv.success || 0} รายการ (ผิด ${nv.errors || 0})`;
  if (row.action === 'APPROVE') return `${nv.status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ'} คำขอ${nv.requestType === 'add' ? 'เพิ่ม' : 'ถอน'}`;
  if (row.action === 'CREATE' && row.entity_type === 'user') return `สร้างบัญชี: ${nv.username || ''}`;
  if (row.action === 'CREATE' && row.entity_type === 'vehicle') return `เพิ่มรถ: ${nv.plate_no || ''}`;

  if (row.action === 'EXPORT') {
    const fmt = nv.format ? String(nv.format).toUpperCase() : null;
    const n = Number(nv.rows);
    return `ส่งออก${fmt ? ` ${fmt}` : ''}${Number.isFinite(n) ? ` ${n.toLocaleString('th-TH')} แถว` : ''}`;
  }
  if (row.action === 'LOGIN')  return 'เข้าสู่ระบบ';
  if (row.action === 'LOGOUT') return 'ออกจากระบบ';

  const fields = Object.keys(nv).filter(k => k !== 'action');
  if (fields.length > 0 && Object.keys(ov).length > 0 && fields.length <= 3) {
    const displayValue = (key, value) => key === 'grade' ? abbreviateGrade(value) || '-' : value ?? '-';
    return fields.map(k => `${FIELD_LABEL[k] || k}: ${displayValue(k, ov[k])} → ${displayValue(k, nv[k])}`).join(' · ');
  }
  // The generic field-list fallback used to read "แก้ไข: …" for EVERY action
  // that carried a new_value, so an EXPORT row rendered as
  // "แก้ไข: format, rows" — an audit entry that named the wrong action. It is
  // now only used for actions that really are edits; anything else falls
  // through to the action badge alone, which is already accurate.
  const isEdit = row.action === 'UPDATE' || row.action === 'CREATE';
  if (isEdit && fields.length > 0 && fields.length <= 5) {
    return `แก้ไข: ${fields.map(k => FIELD_LABEL[k] || k).join(', ')}`;
  }
  if (isEdit && fields.length > 5) return `แก้ไข ${fields.length} รายการ`;
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
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        title={title}
        subtitle="บันทึกการเข้าถึงและแก้ไขข้อมูล เรียงจากล่าสุดไปเก่าสุด"
        actions={
          <button
            onClick={handleExportCsv}
            className="focus-ring inline-flex items-center gap-1.5 text-sm font-medium text-ink bg-surface-raised hover:bg-surface active:bg-surface-border border border-surface-border px-4 min-h-[44px] rounded-lg transition"
          >
            <Download className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
            Export CSV
          </button>
        }
      />

      <FilterBar
        className="mb-4"
        filters={[
          { key: 'action', label: 'กรองตามการกระทำ', value: action, onChange: setAction,
            options: ACTION_OPTIONS.map(o => [o.value, o.label]) },
          { key: 'from', label: 'ตั้งแต่', type: 'date', value: dateFrom, onChange: setDateFrom },
          { key: 'to',   label: 'ถึง',     type: 'date', value: dateTo,   onChange: setDateTo },
        ]}
        count={meta.total}
        countLabel="รายการ"
        onClear={hasFilters ? clearFilters : undefined}
      />

      {loading ? (
        <LoadingState />
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
