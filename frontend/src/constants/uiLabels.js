/**
 * UI Label Constants — ระบบรถรับส่งนักเรียนจังหวัดลำปาง
 *
 * แหล่งอ้างอิงกลางสำหรับ hardcoded UI text ที่ใช้ซ้ำข้ามหลายหน้า
 * อ้างอิงมาตรฐานจาก LABEL_STANDARDS.md
 *
 * หลักการ:
 * - รวมเฉพาะข้อความที่ใช้ซ้ำ 2+ หน้า หรือเป็นมาตรฐานกลางตาม LABEL_STANDARDS.md
 * - ข้อความเฉพาะหน้า / dynamic / ขึ้นกับ context ให้คงไว้ inline
 * - ห้ามรวมข้อมูลจาก DB เช่น ชื่อสังกัด ชื่อโรงเรียน
 */

// ─── Page Titles (ชื่อหน้า Dashboard ตาม §2) ───────────────────────
export const PAGE_TITLES = {
  SCHOOL_DASHBOARD:      'ภาพรวมโรงเรียน',
  AFFILIATION_DASHBOARD: 'ภาพรวมสังกัด',
  PROVINCE_DASHBOARD:    'ภาพรวมจังหวัด',
  DRIVER_DASHBOARD:      'ภาพรวมวันนี้',
};

// ─── Card Labels (ป้ายบน summary cards ตาม §3) ─────────────────────
export const CARD_LABELS = {
  TOTAL_STUDENTS: 'นักเรียนทั้งหมด',
  VEHICLES:       'รถรับส่ง',
  STUDENT_LEAVE:  'นักเรียนลา',
  EMERGENCY:      'เหตุฉุกเฉิน',
  EMERGENCY_7D:   'เหตุฉุกเฉิน (7 วัน)',
  SCHOOLS:        'โรงเรียน',
  AFFILIATIONS:   'สังกัด',
};

// ─── Chart Titles (ชื่อ chart/donut ตาม §3) ────────────────────────
export const CHART_TITLES = {
  MORNING_STATUS: 'สถานะส่งเช้า',
  EVENING_STATUS: 'สถานะรับเย็น',
};

// ─── Section Titles (หัวข้อ section ตาม §3) ─────────────────────────
export const SECTION_TITLES = {
  VEHICLE_STATUS:   'สถานะรถแต่ละคัน',
  SCHOOLS_PENDING:  'โรงเรียนที่ยังมีรายการค้าง',
  EXCEPTION_PANEL:  'จุดที่ต้องดูแลทันที',
  TREND_KPI:        'แนวโน้ม KPI 7 วัน',
};

// ─── Status Labels (badge / donut segment ตาม §3) ──────────────────
export const STATUS = {
  DONE:     'สำเร็จแล้ว',
  SENT:     'ส่งแล้ว',
  RECEIVED: 'รับแล้ว',
  LEAVE:    'ลา',
  PENDING:  'รอ',
  COMPLETE: 'ครบ',
};

// ─── UI Messages (loading, empty, error ตาม §4) ────────────────────
export const UI_MESSAGES = {
  LOADING:           'กำลังโหลด…',
  NO_DATA:           'ไม่มีข้อมูล',
  NOT_FOUND:         'ไม่พบข้อมูลที่ค้นหา',
  VEHICLE_NOT_FOUND: 'ไม่พบรถที่ค้นหา',
  NO_TREND_DATA:     'ไม่มีข้อมูลแนวโน้ม',
  NO_EXCEPTION:      'ไม่มีจุดเตือนสำคัญ — ดำเนินงานปกติ',
  ALL_SCHOOLS_DONE:  'ทุกโรงเรียนดำเนินการครบแล้ว',
};

// ─── Donut Segment Configs (morning/evening — ใช้ซ้ำ 3 dashboards) ──
export const MORNING_SEGMENTS = (done, leave, pending) => [
  { label: STATUS.SENT,    value: done,    color: '#22c55e' },
  { label: STATUS.LEAVE,   value: leave,   color: '#f59e0b' },
  { label: STATUS.PENDING, value: pending, color: '#f97316' },
];

export const EVENING_SEGMENTS = (done, leave, pending) => [
  { label: STATUS.RECEIVED, value: done,    color: '#6366f1' },
  { label: STATUS.LEAVE,    value: leave,   color: '#f59e0b' },
  { label: STATUS.PENDING,  value: pending, color: '#818cf8' },
];

// ─── Banned Terms (คำที่ควรหลีกเลี่ยง ตาม §5) ────────────────────
// ใช้โดย scripts/check-ui-labels.js เพื่อตรวจหา hardcoded UI text ที่หลุดมาตรฐาน
export const BANNED_TERMS = [
  { banned: 'เขตพื้นที่',       replacement: 'สังกัด',                   note: 'ยกเว้นใน regex ตัด prefix ชื่อ DB' },
  { banned: 'ลาวันนี้',         replacement: 'นักเรียนลา',              note: 'ยกเว้น driver context ตาม §6' },
  { banned: 'นักเรียนลาวันนี้',  replacement: 'นักเรียนลา',              note: '' },
  { banned: 'ดำเนินการแล้ว',     replacement: 'สำเร็จแล้ว',              note: '' },
  { banned: 'ยังไม่ครบ',         replacement: 'ยังมีรายการค้าง',          note: '' },
  { banned: 'สถานะรายคัน',      replacement: 'สถานะรถแต่ละคัน',          note: '' },
  { banned: 'ภาพรวมจังหวัดลำปาง', replacement: 'ภาพรวมจังหวัด',          note: 'ไม่ hardcode ชื่อจังหวัด' },
  { banned: 'ภาพรวมเขตพื้นที่',  replacement: 'ภาพรวมสังกัด',            note: '' },
];
