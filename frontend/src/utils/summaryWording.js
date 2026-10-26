/**
 * Wording for the executive summary pages when there is nothing to list.
 *
 * Shared by ExecutiveSummary.jsx and ExecutivePrint.jsx so the screen and
 * the printout say the same thing, and kept free of React so the backend
 * suite can run it (tests/frontendSummaryWording.unit.test.js), the same
 * way utils/kpi.js is checked against the backend's percentage rule.
 *
 * The rule (review of 2026-09-06): the absence of an improvement is not
 * "no change" — there may be declines — and the absence of data is not
 * "no risk". Counts, never arrays, so the helper cannot depend on the
 * pages' metric shape.
 */

/** The sentence shown where the improvements would be listed. */
export function improvementSummary({ improvements = 0, risks = 0, comparable = 0 }) {
  if (improvements > 0) {
    return risks > 0
      ? `มี ${improvements} ตัวชี้วัดที่ดีขึ้น และ ${risks} ตัวชี้วัดที่ลดลงจาก baseline`
      : `มี ${improvements} ตัวชี้วัดที่ดีขึ้นจาก baseline`;
  }
  if (risks > 0) return `ไม่มีตัวชี้วัดที่ดีขึ้น และมี ${risks} ตัวชี้วัดที่ลดลงจาก baseline`;
  if (comparable === 0) return 'ยังไม่มีข้อมูลพอเทียบกับ baseline (ตัวส่วนเป็น 0 หรือไม่มี snapshot) — ยังสรุปไม่ได้ว่าดีขึ้นหรือไม่';
  return `ยังไม่มีการเปลี่ยนแปลงจาก baseline ใน ${comparable} ตัวชี้วัดที่เทียบได้`;
}

/** The heading of the risk box. Low coverage is a risk finding too. */
export function riskHeading({ risks = 0, lowCoverage = 0, comparable = 0 }) {
  if (risks > 0 || lowCoverage > 0) return 'จุดเสี่ยง / ต้องติดตาม';
  if (comparable === 0) return 'ยังประเมินจุดเสี่ยงไม่ได้ (ข้อมูลไม่พอ)';
  return 'ไม่มีจุดเสี่ยงจากข้อมูลปัจจุบัน';
}

/** The line inside an empty risk box. */
export function riskEmptyLine({ comparable = 0 }) {
  return comparable === 0
    ? 'ยังไม่มีข้อมูลพอประเมินจุดเสี่ยง (ตัวส่วนเป็น 0 หรือไม่มี snapshot)'
    : 'ไม่พบ metric ที่ลดลงหรือต่ำกว่า 50%';
}
