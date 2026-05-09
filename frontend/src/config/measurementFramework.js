/**
 * Measurement & Evaluation Framework — Config-driven content.
 * Edit this file to change metrics, thresholds, cautions, or system changes.
 * UI components read from this config only.
 */

export const READINESS = {
  ready:          { label: 'พร้อมวัด',              cls: 'bg-green-100 text-green-700' },
  partial:        { label: 'วัดได้บางส่วน',          cls: 'bg-amber-100 text-amber-700' },
  need_event:     { label: 'ต้องเพิ่ม event log',    cls: 'bg-orange-100 text-orange-700' },
  need_baseline:  { label: 'ต้องเก็บ baseline',      cls: 'bg-blue-100 text-blue-700' },
  need_external:  { label: 'ต้องใช้หลักฐานภายนอก',   cls: 'bg-purple-100 text-purple-700' },
};

export const SOURCE_TAGS = {
  SL:  { label: 'SL',      full: 'System Log (daily_status, checkin_logs)',   cls: 'bg-blue-100 text-blue-700' },
  AL:  { label: 'Audit',   full: 'Audit Log (audit_logs table)',              cls: 'bg-gray-200 text-gray-700' },
  OB:  { label: 'OB',      full: 'Observation (การสังเกต)',                   cls: 'bg-teal-100 text-teal-700' },
  IV:  { label: 'IV',      full: 'Interview (การสัมภาษณ์)',                   cls: 'bg-purple-100 text-purple-700' },
  MM:  { label: 'MM',      full: 'Meeting Minutes (บันทึกประชุม)',            cls: 'bg-amber-100 text-amber-700' },
  EX:  { label: 'Export',  full: 'Export/Report Log',                         cls: 'bg-green-100 text-green-700' },
  QN:  { label: 'QN',      full: 'Questionnaire/Survey',                     cls: 'bg-pink-100 text-pink-700' },
  IL:  { label: 'IL',      full: 'Incident Log (emergency_logs)',             cls: 'bg-red-100 text-red-700' },
  SR:  { label: 'SR',      full: 'System Report (PDF/Excel export)',          cls: 'bg-cyan-100 text-cyan-700' },
  WL:  { label: 'WL',      full: 'Workload Log (บันทึกภาระงาน)',             cls: 'bg-lime-100 text-lime-700' },
};

export const TAB_IDS = {
  metrics:    { id: 'metrics',    label: 'ตัวชี้วัด' },
  thresholds: { id: 'thresholds', label: 'เกณฑ์' },
  changes:    { id: 'changes',    label: 'การปรับระบบ' },
  cautions:   { id: 'cautions',   label: 'ข้อพึงระวัง' },
};

// ═══════════════════════════════════════════════════════════════
// ROLES — 6 roles, each with metrics, thresholds, changes, cautions
// ═══════════════════════════════════════════════════════════════

export const ROLES = [

  // ──────────────────────────────────────────────────────────────
  // 1. PROVINCE
  // ──────────────────────────────────────────────────────────────
  {
    id: 'province', code: 'PR', name: 'จังหวัด (Province)',
    color: 'blue',
    subtitle: 'วัดที่คุณภาพการตัดสินใจเชิงนโยบาย',
    focus: 'Effectiveness — การใช้ระบบส่งผลต่อการสั่งการ/นโยบายที่เกี่ยวข้องกับความปลอดภัยนักเรียนจริงหรือไม่',

    metrics: [
      {
        title: 'Dashboard Usage Before Decision',
        desc: 'จำนวนครั้งที่ผู้ใช้ Province เข้าดู dashboard ภายใน 2 ชม. ก่อนการประชุม/สั่งการ',
        target: '≥ 1 ครั้ง / ประชุม',
        sources: ['SL', 'AL', 'MM'],
        readiness: 'need_event',
        forms: ['DME-6'],
        why: 'ถ้าผู้บริหารตัดสินใจโดยไม่ดูข้อมูลจริง ระบบก็ไม่มีผลต่อคุณภาพนโยบาย',
        evidence: 'audit_logs action=LOGIN + entity_type=dashboard_view ต้องเพิ่ม event ใหม่',
      },
      {
        title: 'Proactive Awareness Rate',
        desc: '% เหตุการณ์สำคัญที่ Province รับรู้จากระบบก่อนได้รับแจ้งทางโทรศัพท์',
        target: '≥ 60%',
        sources: ['SL', 'OB', 'IL'],
        readiness: 'need_baseline',
        forms: ['MIE-6'],
        why: 'วัดว่าระบบช่วยให้ผู้บริหารรู้สถานการณ์ได้เร็วกว่าช่องทางเดิมหรือไม่',
        evidence: 'เปรียบเทียบ timestamp ของ emergency_logs.reported_at กับ audit_logs ที่ province ดู dashboard',
      },
      {
        title: 'Evidence-based Policy Actions',
        desc: 'จำนวนคำสั่ง/การสั่งการที่อ้างอิงข้อมูลจากระบบอย่างชัดเจน ต่อเดือน',
        target: '≥ 2 ครั้ง/เดือน',
        sources: ['IV', 'MM'],
        readiness: 'need_external',
        forms: ['DME-6'],
        why: 'ระบบมีค่าเมื่อข้อมูลถูกใช้ประกอบการตัดสินใจจริง ไม่ใช่แค่ดูแล้วปิด',
        evidence: 'ต้องตรวจจากบันทึกประชุม/คำสั่ง ว่ามีการอ้างอิงข้อมูลจากระบบ',
      },
      {
        title: 'Report Engagement Duration',
        desc: 'เวลาเฉลี่ยที่ Province ใช้ดูรายงานต่อ session (วินาที/นาที)',
        target: '≥ 3 นาที',
        sources: ['SL'],
        readiness: 'need_event',
        forms: [],
        why: 'session ที่สั้นมาก (< 30 วินาที) อาจบ่งบอกว่าไม่ได้อ่านจริง',
        evidence: 'ต้องเพิ่ม session duration tracking ที่ frontend',
      },
    ],

    thresholds: [
      { level: 'ดีมาก', criteria: 'ดู dashboard ก่อนประชุมทุกครั้ง + มี policy action อ้างอิงระบบ ≥ 3 ครั้ง/เดือน + session ≥ 5 นาที', color: 'green' },
      { level: 'ดี', criteria: 'ดู dashboard ≥ 80% ของประชุม + policy action ≥ 2 ครั้ง/เดือน', color: 'green' },
      { level: 'พอใช้', criteria: 'ดู dashboard เป็นครั้งคราว + policy action ≥ 1 ครั้ง/เดือน', color: 'amber' },
      { level: 'ต้องปรับปรุง', criteria: 'ไม่เคยดู dashboard ก่อนตัดสินใจ หรือไม่มี action อ้างอิงข้อมูลเลย', color: 'red' },
    ],

    changes: [
      'เพิ่ม dashboard_view event ใน audit_logs ทุกครั้งที่เปิดหน้า dashboard',
      'เพิ่ม session duration tracking (เวลาที่อยู่ในหน้า)',
      'เพิ่มปุ่ม "รับทราบ/สั่งการ" ที่รายการแจ้งเตือนเพื่อเก็บ action evidence',
      'สร้าง export log เพื่อนับจำนวนครั้งที่ดาวน์โหลดรายงาน',
      'เพิ่ม meeting reference field ในรายงาน PDF เพื่อเชื่อมกับบันทึกประชุม',
    ],

    cautions: [
      'การเข้าดู dashboard ไม่ได้แปลว่าอ่านหรือตัดสินใจ — ต้อง triangulate กับ interview/meeting minutes',
      'Province มีผู้ใช้ 1 คน — sample size จำกัดมาก ไม่สามารถใช้สถิติขั้นสูงได้',
      'ต้องมี baseline ของ decision-making process ก่อนใช้ระบบเพื่อเปรียบเทียบ',
      'policy action ที่นับได้ต้องเป็น action ที่เกี่ยวกับรถรับส่งนักเรียนจริง ไม่ใช่ action ทั่วไป',
    ],
  },

  // ──────────────────────────────────────────────────────────────
  // 2. AFFILIATION
  // ──────────────────────────────────────────────────────────────
  {
    id: 'affiliation', code: 'AF', name: 'สังกัด (Affiliation)',
    color: 'teal',
    subtitle: 'วัดที่ความสามารถตรวจจับปัญหาเชิงรุก (Proactive Supervision)',
    focus: 'Effectiveness — สังกัดใช้ระบบตรวจจับและจัดการปัญหาได้ก่อนที่จะเกิดเหตุจริงหรือไม่',

    metrics: [
      {
        title: 'Proactive Detection Rate',
        desc: '% เหตุการณ์/ปัญหาที่สังกัดตรวจพบจาก dashboard ก่อนโรงเรียนแจ้ง',
        target: '≥ 50%',
        sources: ['SL', 'OB', 'IL'],
        readiness: 'need_baseline',
        forms: ['MIE-6'],
        why: 'ถ้าสังกัดรู้เรื่องทีหลังโรงเรียนเสมอ แสดงว่าระบบไม่ช่วยเรื่อง early detection',
        evidence: 'เปรียบเทียบ timestamp ที่สังกัดเปิดดู dashboard vs timestamp emergency_logs',
      },
      {
        title: 'Alert-to-View Latency',
        desc: 'เวลาเฉลี่ยตั้งแต่เกิด alert จนสังกัดเปิดดู (ชั่วโมง)',
        target: '≤ 4 ชม.',
        sources: ['SL', 'AL'],
        readiness: 'need_event',
        forms: ['DME-6'],
        why: 'ยิ่ง latency ต่ำ ยิ่งแสดงว่าสังกัดติดตามระบบอย่างสม่ำเสมอ',
        evidence: 'ต้องเพิ่ม alert_view event ใน audit_logs',
      },
      {
        title: 'Proactive Follow-up Actions',
        desc: 'จำนวนครั้งที่สังกัดดำเนินการติดตามโรงเรียนโดยใช้ข้อมูลจากระบบ ต่อเดือน',
        target: '≥ 3 ครั้ง/เดือน',
        sources: ['IV', 'AL'],
        readiness: 'need_external',
        forms: ['MIE-6'],
        why: 'การติดตามเชิงรุกลดโอกาสเกิดเหตุ — ระบบต้องเป็นเครื่องมือที่ขับเคลื่อนการติดตาม',
        evidence: 'ต้องเพิ่ม follow-up action button + event log ที่หน้า dashboard',
      },
      {
        title: 'Pending School Follow-up Rate',
        desc: '% โรงเรียนที่มีรายการค้างแล้วสังกัดเริ่มติดตามภายใน SLA (24 ชม.)',
        target: '≥ 80%',
        sources: ['SL', 'AL'],
        readiness: 'need_event',
        forms: [],
        why: 'วัดว่าข้อมูลค้างในระบบถูกใช้เป็น trigger สำหรับ action จริงหรือไม่',
        evidence: 'ต้องเพิ่ม acknowledgment event เมื่อสังกัดเริ่มติดตามโรงเรียนที่ค้าง',
      },
    ],

    thresholds: [
      { level: 'ดีมาก', criteria: 'ตรวจจับเชิงรุก ≥ 70% + latency ≤ 2 ชม. + follow-up ≥ 90%', color: 'green' },
      { level: 'ดี', criteria: 'ตรวจจับ ≥ 50% + latency ≤ 4 ชม. + follow-up ≥ 80%', color: 'green' },
      { level: 'พอใช้', criteria: 'ตรวจจับ ≥ 30% + latency ≤ 8 ชม.', color: 'amber' },
      { level: 'ต้องปรับปรุง', criteria: 'ไม่มีการตรวจจับเชิงรุก หรือ latency > 24 ชม.', color: 'red' },
    ],

    changes: [
      'เพิ่ม alert_view event ใน audit_logs เมื่อเปิดดูรายการแจ้งเตือน/ค้าง',
      'เพิ่มปุ่ม "ติดตามโรงเรียน" พร้อม event log ที่หน้าภาพรวมสังกัด',
      'เพิ่ม school escalation tracking (เปิด-ปิดการติดตาม)',
      'เพิ่ม pending-case acknowledgment timestamp',
    ],

    cautions: [
      'การเปิด alert ≠ การลงมือทำ — ต้องแยก "เห็น" กับ "ติดตามจริง"',
      'โรงเรียนอาจแจ้งเหตุผ่านช่องทางนอกระบบ (โทร, LINE ส่วนตัว) ทำให้ detection rate ดูต่ำเกินจริง',
      'สังกัดบางเขตมีโรงเรียน 1-2 แห่ง — pattern อาจไม่ชัด',
      'ต้องมี baseline ของ pre-system follow-up behavior เพื่อเปรียบเทียบ',
    ],
  },

  // ──────────────────────────────────────────────────────────────
  // 3. SCHOOL
  // ──────────────────────────────────────────────────────────────
  {
    id: 'school', code: 'SC', name: 'โรงเรียน (School)',
    color: 'green',
    subtitle: 'วัดที่ความครบถ้วน ถูกต้อง ทันเวลา และภาระงาน',
    focus: 'Efficiency — ระบบช่วยลดภาระงานและเพิ่มความถูกต้องของข้อมูลได้จริงหรือไม่',

    metrics: [
      {
        title: 'Data Completeness Rate',
        desc: '% นักเรียนที่มีข้อมูลครบ (ชื่อ, ชั้น, รถ, ผู้ปกครอง, เบอร์โทร)',
        target: '≥ 95%',
        sources: ['SL'],
        readiness: 'ready',
        forms: ['DME-6'],
        why: 'ข้อมูลไม่ครบทำให้ check-in/notification ทำงานไม่ได้ ส่งผลต่อความปลอดภัย',
        evidence: 'คำนวณจาก students table: COUNT(vehicle_id IS NOT NULL AND parent fields filled) / total',
      },
      {
        title: 'Timeliness of Data Entry',
        desc: 'จำนวนวันหลังเปิดภาคเรียนที่ข้อมูลนักเรียน ≥ 90% ครบ',
        target: '≤ 3 วัน',
        sources: ['SL', 'AL'],
        readiness: 'ready',
        forms: [],
        why: 'ยิ่งกรอกเร็ว ระบบก็เริ่มทำงานได้เร็ว — ล่าช้า = นักเรียนไม่ได้รับการติดตามช่วงแรก',
        evidence: 'audit_logs WHERE action=IMPORT — timestamp ของ import ครั้งแรกเทียบกับวันเปิดเรียน',
      },
      {
        title: 'Correction Rate',
        desc: '% ข้อมูลที่ต้องแก้ไขหลังนำเข้า (ยิ่งน้อยยิ่งดี)',
        target: '≤ 5%',
        sources: ['AL'],
        readiness: 'ready',
        forms: ['MIE-6'],
        why: 'อัตราแก้ไขสูง = template/process ไม่ดี หรือ source data คุณภาพต่ำ',
        evidence: 'audit_logs WHERE action=UPDATE AND entity_type=student / total students imported',
      },
      {
        title: 'Work Burden Reduction',
        desc: 'เวลาเฉลี่ยที่ครู/เจ้าหน้าที่ใช้จัดการข้อมูลต่อวัน เทียบก่อน-หลังใช้ระบบ',
        target: 'ลดลง ≥ 30%',
        sources: ['QN', 'IV', 'WL'],
        readiness: 'need_external',
        forms: ['DME-6'],
        why: 'ถ้าระบบเพิ่มภาระแทนที่จะลด = failure ในเชิง efficiency',
        evidence: 'ต้องใช้ questionnaire ก่อน-หลัง + workload diary/log',
      },
    ],

    thresholds: [
      { level: 'ดีมาก', criteria: 'ครบ ≥ 98% ภายใน 2 วัน + แก้ไข ≤ 3% + ภาระลด ≥ 40%', color: 'green' },
      { level: 'ดี', criteria: 'ครบ ≥ 95% ภายใน 3 วัน + แก้ไข ≤ 5% + ภาระลด ≥ 30%', color: 'green' },
      { level: 'พอใช้', criteria: 'ครบ ≥ 80% ภายใน 7 วัน + ภาระไม่เพิ่ม', color: 'amber' },
      { level: 'ต้องปรับปรุง', criteria: 'ครบ < 80% หรือกรอก > 7 วัน หรือภาระเพิ่มขึ้น', color: 'red' },
    ],

    changes: [
      'ลดคอลัมน์ template นำเข้าจาก 12 → 9 (ระบบเติมโรงเรียน/สถานะ/term อัตโนมัติ)',
      'เพิ่ม daily data completeness snapshot (บันทึก % ครบถ้วนรายวัน)',
      'เพิ่ม correction log tracking ใน audit_logs',
      'เพิ่ม weekly workload survey form หรือ workload entry point',
    ],

    cautions: [
      'ข้อมูลครบไม่เท่ากับข้อมูลถูก — ต้อง spot-check ด้วย',
      'ข้อมูลทันเวลาแต่ภาระงานสูงเกินไป = ไม่ยั่งยืน',
      'ต้องมี baseline ก่อนใช้ระบบ (pre-survey) จึงวัด burden reduction ได้',
      'โรงเรียนบางแห่งอาจมีเจ้าหน้าที่ธุรการกรอกแทนครู — ต้องระบุ actor ให้ชัด',
    ],
  },

  // ──────────────────────────────────────────────────────────────
  // 4. DRIVER
  // ──────────────────────────────────────────────────────────────
  {
    id: 'driver', code: 'DR', name: 'คนขับรถ (Driver)',
    color: 'orange',
    subtitle: 'วัดที่ความสม่ำเสมอ ความเร็ว และ UX Acceptance สำหรับผู้สูงอายุ',
    focus: 'Efficiency + Effectiveness — ใช้ได้สม่ำเสมอ (efficiency) และช่วยให้นักเรียนปลอดภัยขึ้น (effectiveness)',

    metrics: [
      {
        title: 'Pre-departure Check-in Rate',
        desc: '% วันที่คนขับเช็กอินนักเรียนทุกคนก่อนออกรถ',
        target: '≥ 90%',
        sources: ['SL'],
        readiness: 'ready',
        forms: ['DME-6'],
        why: 'เช็กอินก่อนออกรถ = ยืนยันว่านักเรียนทุกคนขึ้นรถแล้ว ลดการลืมเด็กไว้',
        evidence: 'daily_status.morning_done = TRUE ก่อนเวลา departure (ปัจจุบันวัดได้จาก morning_ts)',
      },
      {
        title: 'Completion Consistency',
        desc: '% ของเดือนที่คนขับเช็กอินครบ 100% ทุกคนในรถ (ไม่นับวันลา)',
        target: '≥ 85%',
        sources: ['SL'],
        readiness: 'ready',
        forms: [],
        why: 'ความสม่ำเสมอสำคัญกว่าค่าเฉลี่ย — วันที่ไม่เช็ก = วันที่เสี่ยง',
        evidence: 'daily_status: COUNT(dates where all students morning_done) / total working days',
      },
      {
        title: 'Usage Continuity (Streak)',
        desc: 'จำนวนวันทำงานต่อเนื่องสูงสุดที่ใช้ระบบโดยไม่ขาด',
        target: '≥ 15 วัน/เดือน',
        sources: ['SL'],
        readiness: 'ready',
        forms: ['MIE-6'],
        why: 'streak ยาว = ระบบเป็นส่วนหนึ่งของ routine, streak สั้น = ยังไม่ adopt',
        evidence: 'checkin_logs / daily_status: นับ consecutive dates per driver',
      },
      {
        title: 'UX Satisfaction (Elderly-friendly)',
        desc: 'คะแนนความพึงพอใจด้านความง่ายในการใช้งาน จากแบบสอบถามผู้สูงอายุ',
        target: '≥ 4.0 / 5.0',
        sources: ['QN'],
        readiness: 'need_external',
        forms: ['DME-6'],
        why: 'ถ้าผู้สูงอายุใช้ไม่ได้ = adoption ต่ำ = ระบบล้มเหลว',
        evidence: 'ต้องใช้แบบสอบถาม SUS หรือ custom usability survey',
      },
    ],

    thresholds: [
      { level: 'ดีมาก', criteria: 'เช็กอินก่อนออกรถ ≥ 95% + ครบทุกคน ≥ 90% + streak ≥ 18 วัน + UX ≥ 4.5', color: 'green' },
      { level: 'ดี', criteria: 'เช็กอิน ≥ 90% + ครบ ≥ 85% + streak ≥ 15 วัน', color: 'green' },
      { level: 'พอใช้', criteria: 'เช็กอิน ≥ 70% + ครบ ≥ 70% + UX ≥ 3.5', color: 'amber' },
      { level: 'ต้องปรับปรุง', criteria: 'เช็กอิน < 70% หรือหยุดใช้ > 5 วันต่อเนื่อง หรือ UX < 3.0', color: 'red' },
    ],

    changes: [
      'เพิ่ม progress bar ขนาดใหญ่ "รับแล้ว X/Y คน" สำหรับ elderly-friendly UX',
      'ปรับ font/button/spacing ให้เหมาะผู้สูงอายุ',
      'เพิ่มปุ่มยกเลิกการลา',
      'เพิ่ม late check-in flag (เช็กอินหลังเวลาออกรถ) เพื่อวัด timeliness',
    ],

    cautions: [
      'metric ต่ำอาจสะท้อน UX problem ไม่ใช่ความผิดคนขับ — ต้องแยกให้ชัด',
      'คนขับบางคนให้ผู้ช่วยกรอกแทน — ต้องระบุ actual user',
      'ค่าเฉลี่ยอาจดูดี แต่ความแปรปรวนสูง = ไม่สม่ำเสมอ → ดู SD ด้วย',
      'ตัวเลข daily_status อาจไม่สะท้อนเวลาจริงถ้าเช็กอินย้อนหลัง',
      'ต้องแยกบัญชีคนขับที่ active จริง vs บัญชีที่มีแต่ไม่เคย login',
    ],
  },

  // ──────────────────────────────────────────────────────────────
  // 5. TRANSPORT
  // ──────────────────────────────────────────────────────────────
  {
    id: 'transport', code: 'TR', name: 'ขนส่ง (Transport)',
    color: 'indigo',
    subtitle: 'วัดที่อัตราปิดความเสี่ยง ความเร็วในการจัดการ และความยั่งยืน',
    focus: 'Effectiveness — รถที่ไม่ผ่านตรวจ/ประกันหมดถูกจัดการได้เร็วและไม่กลับมาเสี่ยงซ้ำ',

    metrics: [
      {
        title: 'Risk Closure within SLA',
        desc: '% ความเสี่ยง (ไม่ผ่านตรวจ, ประกันหมด, ยังไม่ตรวจ) ที่ปิดภายใน 30 วัน',
        target: '≥ 80%',
        sources: ['SL'],
        readiness: 'partial',
        forms: ['MIE-6'],
        why: 'ความเสี่ยงที่ไม่ถูกปิดตามเวลา = นักเรียนเดินทางด้วยรถที่ไม่ปลอดภัย',
        evidence: 'vehicle_inspections: เปรียบเทียบ created_at กับ next inspection ที่ผ่าน (ต้องเพิ่ม risk_cases table เพื่อ lifecycle tracking)',
      },
      {
        title: 'Non-recurrence Rate',
        desc: '% รถที่แก้ไขแล้วไม่กลับมาเป็นความเสี่ยงซ้ำภายใน 30 วัน',
        target: '≥ 90%',
        sources: ['SL'],
        readiness: 'partial',
        forms: [],
        why: 'ถ้าปิดแล้วกลับมาเสี่ยงซ้ำ = การแก้ไขไม่ยั่งยืน',
        evidence: 'vehicle_inspections: หา pattern PASSED → FAILED/NEEDS_FIX ภายใน 30 วัน',
      },
      {
        title: 'Unresolved Risk Volume',
        desc: 'จำนวนรถที่ยังมีความเสี่ยงค้างอยู่ ณ สิ้นเดือน',
        target: '≤ 5 คัน',
        sources: ['SL'],
        readiness: 'ready',
        forms: ['DME-6'],
        why: 'ยิ่งค้างเยอะ ยิ่งเสี่ยง — ต้องดูแนวโน้มรายเดือน',
        evidence: 'คำนวณจาก vehicles WHERE latest_inspection ≠ PASSED OR insurance_expiry < NOW()',
      },
      {
        title: 'Time-to-Close Risk',
        desc: 'เวลาเฉลี่ยตั้งแต่พบความเสี่ยงจนปิด (วัน)',
        target: '≤ 14 วัน',
        sources: ['SL'],
        readiness: 'partial',
        forms: [],
        why: 'เวลาปิดนานเกินไป = กระบวนการแก้ไขมีปัญหา',
        evidence: 'ต้องเพิ่ม risk_cases table สำหรับ opened_at → resolved_at tracking',
      },
    ],

    thresholds: [
      { level: 'ดีมาก', criteria: 'ปิดภายใน SLA ≥ 90% + ไม่กลับซ้ำ ≥ 95% + ค้าง ≤ 2 + time-to-close ≤ 7 วัน', color: 'green' },
      { level: 'ดี', criteria: 'ปิด ≥ 80% + ไม่กลับซ้ำ ≥ 90% + ค้าง ≤ 5 + time-to-close ≤ 14 วัน', color: 'green' },
      { level: 'พอใช้', criteria: 'ปิด ≥ 60% + ค้าง ≤ 10', color: 'amber' },
      { level: 'ต้องปรับปรุง', criteria: 'ปิด < 60% หรือ ค้าง > 10 หรือ time-to-close > 30 วัน', color: 'red' },
    ],

    changes: [
      'เพิ่ม risk_cases table สำหรับ lifecycle tracking (OPEN → IN_PROGRESS → CLOSED)',
      'เพิ่ม assigned owner field ใน risk case',
      'เพิ่ม opened_at / due_at / closed_at timestamps',
      'เพิ่ม recurrence detection flag',
      'เพิ่ม quick filters + action shortcuts บน dashboard',
      'เพิ่ม deep-link จาก dashboard ไปฟอร์มตรวจพร้อม prefill',
    ],

    cautions: [
      'ปิดแจ้งเตือน ≠ แก้ปัญหาจริง — ต้อง verify ด้วยผลตรวจรอบถัดไป',
      'SLA measurement ต้องมี opened_at timestamp — ปัจจุบันยังต้องเพิ่ม risk_cases table',
      'Non-recurrence ต้องดูข้อมูลอย่างน้อย 2-3 เดือนถึงจะมีความหมาย',
      'ต้องแยก "ข้อมูลยังไม่กรอก" กับ "เสี่ยงจริง" — ไม่มีข้อมูลประกัน ≠ ไม่มีประกัน',
    ],
  },

  // ──────────────────────────────────────────────────────────────
  // 6. ADMIN
  // ──────────────────────────────────────────────────────────────
  {
    id: 'admin', code: 'AD', name: 'ผู้ดูแลระบบ (Admin)',
    color: 'purple',
    subtitle: 'วัดที่สุขภาพระบบ การ adopt ของผู้ใช้ และคุณภาพข้อมูล',
    focus: 'Efficiency — ระบบทำงานได้ต่อเนื่อง ผู้ใช้ใช้งานจริง ข้อมูลมีคุณภาพ',

    metrics: [
      {
        title: 'Active Account Rate',
        desc: '% บัญชีที่ is_active=true AND เคย login อย่างน้อย 1 ครั้ง',
        target: '≥ 80%',
        sources: ['SL'],
        readiness: 'ready',
        forms: ['DME-6'],
        why: 'บัญชีที่สร้างแต่ไม่เคยใช้ = onboarding ล้มเหลว',
        evidence: 'users table: SUM(is_active AND last_login IS NOT NULL) / COUNT(*)',
      },
      {
        title: 'Password Reset Frequency',
        desc: 'จำนวนครั้งที่ admin ต้อง reset password ให้ผู้ใช้ ต่อเดือน (ยิ่งน้อยยิ่งดี)',
        target: '≤ 5 ครั้ง/เดือน',
        sources: ['AL'],
        readiness: 'ready',
        forms: [],
        why: 'Reset บ่อย = ผู้ใช้ลืมรหัสผ่าน = อาจจำเป็นต้องมีระบบ recovery ดีกว่า',
        evidence: 'audit_logs WHERE action=UPDATE AND new_value LIKE "%reset_password%"',
      },
      {
        title: 'Onboarding Issue Rate',
        desc: '% ผู้ใช้ใหม่ที่พบปัญหาภายใน 7 วันแรก (ต้อง support จาก admin)',
        target: '≤ 10%',
        sources: ['AL', 'IV'],
        readiness: 'need_external',
        forms: ['MIE-6'],
        why: 'ปัญหา onboarding สูง = UX หรือ training ไม่เพียงพอ',
        evidence: 'ต้องเก็บ support request log หรือ interview admin',
      },
      {
        title: 'Data Health Score',
        desc: 'คะแนนรวมความสมบูรณ์ของข้อมูลหลักในระบบ (นักเรียน, รถ, ผู้ปกครอง, ประกัน)',
        target: '≥ 85%',
        sources: ['SL'],
        readiness: 'partial',
        forms: ['DME-6'],
        why: 'คุณภาพข้อมูลเป็น foundation ของทุก metric อื่น — ถ้า data ไม่ดี ทุกอย่างผิด',
        evidence: 'คำนวณจาก: students มี vehicle + parent / vehicles มี insurance_expiry / parents มี phone',
      },
    ],

    thresholds: [
      { level: 'ดีมาก', criteria: 'Active ≥ 90% + Reset ≤ 2/เดือน + Onboarding issue ≤ 5% + Health ≥ 90%', color: 'green' },
      { level: 'ดี', criteria: 'Active ≥ 80% + Reset ≤ 5/เดือน + Health ≥ 85%', color: 'green' },
      { level: 'พอใช้', criteria: 'Active ≥ 60% + Health ≥ 70%', color: 'amber' },
      { level: 'ต้องปรับปรุง', criteria: 'Active < 60% หรือ Health < 70% หรือ Reset > 10/เดือน', color: 'red' },
    ],

    changes: [
      'สร้างหน้า Admin Dashboard แยกจาก Province (ทำแล้ว)',
      'เพิ่ม user management CRUD + reset password + must_change_password (ทำแล้ว)',
      'เพิ่ม admin audit log viewer (ทำแล้ว)',
      'เพิ่ม dormant account detection (บัญชีที่ไม่เคย login > 30 วัน)',
      'เพิ่ม data quality health summary dashboard',
      'เพิ่ม onboarding support log / ticket tracking',
    ],

    cautions: [
      'Admin ที่ทำงานเยอะไม่ได้แปลว่าระบบดี — อาจแปลว่าระบบมีปัญหาเยอะ',
      'ถ้า reset password สูง อาจสะท้อน UX/onboarding แย่ ไม่ใช่ security issue',
      'Active rate อาจสูงเทียมถ้ามีบัญชีทดสอบที่ยัง active',
      'Data health score ต้องกำหนดสูตรคำนวณและน้ำหนักแต่ละ field ให้ชัดก่อนใช้',
      'ต้องแยก metric ที่วัด "ระบบทำงานได้" กับ "ผู้ใช้ใช้ระบบจริง"',
    ],
  },
];
