import { bangkokDateDaysAgo } from './thaiTime.js';

export function incidentDateError(value, today, earliest = bangkokDateDaysAgo(30)) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'กรุณาเลือกวันที่';
  const [year, month, day] = value.split('-').map(Number);
  const calendar = new Date(`${value}T00:00:00Z`);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day) return 'วันที่ไม่ถูกต้อง';
  if (value > today || value < earliest) return 'เลือกวันนี้หรือย้อนหลังได้ไม่เกิน 30 วัน';
  return '';
}

export function filterIncidentRows(rows, query) {
  const term = String(query || '').trim().toLocaleLowerCase('th');
  return rows.filter(row => !term || `${row.name || ''} ${row.school_name || ''}`.toLocaleLowerCase('th').includes(term));
}

// Ignore a response belonging to an older vehicle/date/round/refresh request.
export function incidentPhase(load, requestKey) {
  return load.key === requestKey ? load.phase : 'loading';
}

export function incidentErrorMessage(status) {
  if (status === 403) return 'บัญชีนี้ไม่มีสิทธิ์เปิดข้อมูล กรุณาติดต่อผู้ดูแลระบบ';
  if (status === 404) return 'ไม่พบรถคันนี้ในรายการ กรุณากลับไปค้นทะเบียนรถอีกครั้ง';
  if (status === 400) return 'วันที่หรือรอบรถไม่ถูกต้อง กรุณาเลือกใหม่';
  if (status === 401) return 'กรุณาเข้าสู่ระบบใหม่';
  return 'ยังโหลดข้อมูลไม่ได้ กรุณาตรวจสอบการเชื่อมต่อแล้วลองใหม่';
}
