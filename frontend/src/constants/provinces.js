// Phase 10.13A-22 — canonical Thai province list for structured plate input.
// ลำปาง first (project default); 'กรุงเทพมหานคร' is the canonical Bangkok form
// (operators sometimes type 'กทม' free-hand — the dropdown standardizes it).
export const THAI_PROVINCES = [
  'ลำปาง',
  'กรุงเทพมหานคร',
  'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี',
  'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท', 'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่',
  'ตรัง', 'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม', 'นครราชสีมา',
  'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน', 'บึงกาฬ',
  'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี', 'ปัตตานี',
  'พระนครศรีอยุธยา', 'พะเยา', 'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก',
  'เพชรบุรี', 'เพชรบูรณ์', 'แพร่', 'ภูเก็ต', 'มหาสารคาม', 'มุกดาหาร',
  'แม่ฮ่องสอน', 'ยโสธร', 'ยะลา', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง', 'ราชบุรี',
  'ลพบุรี', 'ลำพูน', 'เลย', 'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล',
  'สมุทรปราการ', 'สมุทรสงคราม', 'สมุทรสาคร', 'สระแก้ว', 'สระบุรี', 'สิงห์บุรี',
  'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์', 'หนองคาย', 'หนองบัวลำภู',
  'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี',
];

// Build the canonical human display plate from structured parts (mirrors the
// backend's buildStructuredPlate — backend remains the source of truth).
export function buildPlateNo(prefix, number, province) {
  const p = String(prefix || '').trim();
  const n = String(number || '').trim();
  const prov = String(province || '').trim();
  if (!p || !n || !prov) return '';
  return `${p} ${n} ${prov}`;
}

// Normalized/login form (compact, no spaces/dashes, lowercase) — for preview only.
export function normalizedLoginPlate(plateNo) {
  return String(plateNo || '').replace(/[\s-]+/g, '').toLowerCase();
}

// Best-effort split of an existing plate string back into structured parts
// (used when reusing an existing vehicle). Returns null if it can't parse.
export function parsePlateParts(plateNo) {
  const m = String(plateNo || '').match(/^\s*([0-9]?[฀-๙]{1,3})\s*([0-9]{1,4})\s*([฀-๙]*)\s*$/);
  if (!m) return null;
  return { prefix: m[1], number: m[2], province: (m[3] || '').trim() };
}
