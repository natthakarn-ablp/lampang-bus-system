/**
 * Label Helpers — ระบบรถรับส่งนักเรียนจังหวัดลำปาง
 *
 * Utility functions สำหรับการแสดงผล label ที่ซ้ำบ่อย
 * ใช้ร่วมกับ constants/uiLabels.js
 *
 * แนวทางการใช้:
 * - ถ้า label เป็น static text ที่ไม่มี logic → import ตรงจาก uiLabels.js
 *   เช่น: import { PAGE_TITLES } from '../constants/uiLabels';
 *         <h1>{PAGE_TITLES.SCHOOL_DASHBOARD}</h1>
 *
 * - ถ้า label ต้องมี logic เล็กน้อย → ใช้ helper จากไฟล์นี้
 *   เช่น: <p>{emergencyLabel(count)}</p>
 */

import { CARD_LABELS, STATUS, UI_MESSAGES } from '../constants/uiLabels';

/**
 * สร้าง label สำหรับ card เหตุฉุกเฉินพร้อม suffix ช่วงเวลา
 * @param {'7d'|'today'|null} period
 * @returns {string} เช่น "เหตุฉุกเฉิน (7 วัน)" หรือ "เหตุฉุกเฉิน"
 */
export function emergencyLabel(period) {
  if (period === '7d') return CARD_LABELS.EMERGENCY_7D;
  return CARD_LABELS.EMERGENCY;
}

/**
 * สร้าง label สำหรับ subtitle ของ card ที่แสดง "ครบแล้ว" หรือ "จาก N คน"
 * @param {number} pending - จำนวนที่รอ
 * @param {number} total - จำนวนทั้งหมด
 * @returns {string}
 */
export function pendingSub(pending, total) {
  if (pending === 0) return `${STATUS.COMPLETE}แล้ว`;
  return `จาก ${total} คน`;
}

/**
 * เลือก message สำหรับ empty state ตาม context
 * @param {'vehicle'|'student'|'trend'|'generic'} context
 * @returns {string}
 */
export function emptyMessage(context) {
  switch (context) {
    case 'vehicle': return UI_MESSAGES.VEHICLE_NOT_FOUND;
    case 'trend':   return UI_MESSAGES.NO_TREND_DATA;
    case 'search':  return UI_MESSAGES.NOT_FOUND;
    default:        return UI_MESSAGES.NO_DATA;
  }
}

/**
 * สร้าง label "ลา N" สำหรับ badge/tag
 * @param {number} count
 * @returns {string} เช่น "ลา 3" หรือ ""
 */
export function leaveTag(count) {
  if (!count || count <= 0) return '';
  return `${STATUS.LEAVE} ${count}`;
}

/**
 * สร้าง label "รอ N" สำหรับ badge/tag
 * @param {number} count
 * @returns {string} เช่น "รอ 5" หรือ ""
 */
export function pendingTag(count) {
  if (!count || count <= 0) return '';
  return `${STATUS.PENDING} ${count}`;
}
