'use strict';

/**
 * Canonical research metric registry — the single source of truth for what the
 * evaluation framework claims to measure, and what evidence each claim needs.
 *
 * Why this file exists (audit 2026-09-04, Major 1 + Major 2):
 *   The UI used to call a role "พร้อมประเมิน" once it had 20 raw audit actions,
 *   and `/api/admin/research-export` shipped a hardcoded `dme_mie_ready: true`.
 *   Both are readiness claims the underlying data never supported: 1,757 logins
 *   and 3,257 student creates say the system is used, not that a metric can be
 *   evaluated. Readiness is now derived per metric from the evidence that
 *   metric actually requires.
 *
 * Categories keep four different kinds of claim from being averaged together:
 *   operational_kpi    — how the service runs (system-derivable)
 *   participation_kpi  — who influenced a decision, and whether the loop closed
 *   research_outcome   — a pre/post claim about effect; needs a frozen protocol
 *   external_evidence  — only obtainable from an instrument (survey/interview)
 *
 * Evidence requirements:
 *   system_snapshot     — a daily_snapshots row fresh enough to describe "now"
 *   baseline_pair       — a baseline AND a post snapshot inside the protocol window
 *   audit_event         — named audit_logs event types must actually be present
 *   external_instrument — a registered, versioned external evidence record
 *
 * Nothing here may report a metric as evaluable on action volume alone.
 */

const METRIC_CATEGORIES = Object.freeze({
  OPERATIONAL_KPI: 'operational_kpi',
  PARTICIPATION_KPI: 'participation_kpi',
  RESEARCH_OUTCOME: 'research_outcome',
  EXTERNAL_EVIDENCE: 'external_evidence',
});

const EVIDENCE_REQUIREMENTS = Object.freeze({
  SYSTEM_SNAPSHOT: 'system_snapshot',
  BASELINE_PAIR: 'baseline_pair',
  AUDIT_EVENT: 'audit_event',
  EXTERNAL_INSTRUMENT: 'external_instrument',
});

/** Evidence status vocabulary. Deliberately not "PASS" or "ready to evaluate". */
const EVIDENCE_STATUS = Object.freeze({
  SYSTEM_EVIDENCE: 'system_evidence',
  PARTIAL: 'partial_evidence',
  MISSING: 'evidence_missing',
});

/** Thai labels used by the UI. `system_evidence` is NOT "พร้อมประเมิน". */
const EVIDENCE_STATUS_LABEL_TH = Object.freeze({
  [EVIDENCE_STATUS.SYSTEM_EVIDENCE]: 'มีหลักฐานระบบเบื้องต้น',
  [EVIDENCE_STATUS.PARTIAL]: 'มีหลักฐานบางส่วน',
  [EVIDENCE_STATUS.MISSING]: 'ยังไม่มีหลักฐานพอ',
});

/**
 * A snapshot older than this cannot describe the current period, so any metric
 * reading from it degrades instead of silently reporting a stale number.
 * 14 days is about two operating weeks; production snapshots stopped on
 * 2026-06-20, which is exactly the situation this rule exists to surface.
 */
const SNAPSHOT_FRESHNESS_MAX_AGE_DAYS = 14;

/**
 * Minimum observation period before a pre/post comparison may be reported at
 * all. Shorter than this and the delta is noise, whatever the protocol says.
 */
const MIN_BASELINE_POST_GAP_DAYS = 30;

const METRICS = Object.freeze([
  // ── PROVINCE ──────────────────────────────────────────────────────────────
  {
    key: 'province.dashboard_usage_before_decision',
    role: 'province',
    title: 'Dashboard Usage Before Decision',
    title_th: 'การเปิดดูข้อมูลก่อนการตัดสินใจ',
    category: METRIC_CATEGORIES.PARTICIPATION_KPI,
    formula: 'count(dashboard_view within 2h before a recorded decision) / count(decisions)',
    numerator: 'audit_logs entity_type=dashboard_view ภายใน 2 ชั่วโมงก่อน decision_log',
    denominator: 'จำนวน decision_log ในช่วงเวลา',
    missing_data_rule: 'ถ้าไม่มี decision_log ในช่วง ให้รายงานเป็น null ห้ามแทนด้วย 0',
    sources: ['SL', 'AL', 'MM'],
    requires: [EVIDENCE_REQUIREMENTS.AUDIT_EVENT],
    required_events: ['decision_log', 'dashboard_view'],
    instrument: null,
  },
  {
    key: 'province.proactive_awareness_rate',
    role: 'province',
    title: 'Proactive Awareness Rate',
    title_th: 'อัตราการรับรู้เหตุการณ์ผ่านระบบก่อนช่องทางเดิม',
    category: METRIC_CATEGORIES.RESEARCH_OUTCOME,
    formula: '(events known via system first) / (all significant events)',
    numerator: 'emergency_logs ที่ province เปิดดูก่อนเวลาแจ้งทางโทรศัพท์',
    denominator: 'emergency_logs ทั้งหมดในช่วง',
    missing_data_rule: 'เหตุการณ์ที่ไม่มีเวลาแจ้งทางโทรศัพท์ต้องถูกตัดออกจากตัวส่วนและรายงานจำนวนที่ตัด',
    sources: ['SL', 'OB', 'IL'],
    requires: [EVIDENCE_REQUIREMENTS.BASELINE_PAIR, EVIDENCE_REQUIREMENTS.EXTERNAL_INSTRUMENT],
    required_events: [],
    instrument: 'MIE-6',
  },
  {
    key: 'province.evidence_based_policy_actions',
    role: 'province',
    title: 'Evidence-based Policy Actions',
    title_th: 'จำนวนการสั่งการที่อ้างอิงข้อมูลจากระบบ',
    category: METRIC_CATEGORIES.EXTERNAL_EVIDENCE,
    formula: 'count(policy actions citing system data) per month',
    numerator: 'คำสั่ง/มติที่อ้างอิงข้อมูลระบบ จากบันทึกประชุมหรือการสัมภาษณ์',
    denominator: 'เดือน',
    missing_data_rule: 'เดือนที่ไม่มีบันทึกประชุมให้เป็น null ห้ามนับเป็น 0',
    sources: ['IV', 'MM'],
    requires: [EVIDENCE_REQUIREMENTS.EXTERNAL_INSTRUMENT],
    required_events: [],
    instrument: 'DME-6',
  },
  {
    key: 'province.report_engagement_duration',
    role: 'province',
    title: 'Report Engagement Duration',
    title_th: 'ระยะเวลาที่ใช้กับรายงาน',
    category: METRIC_CATEGORIES.OPERATIONAL_KPI,
    formula: 'median(seconds between report open and report close or export)',
    numerator: 'ผลต่างเวลาระหว่าง report_view และ EXPORT หรือการออกจากหน้า',
    denominator: 'จำนวน session ที่เปิดรายงาน',
    missing_data_rule: 'session ที่ไม่มีเหตุการณ์ปิดต้องถูกตัดออกและรายงานสัดส่วนที่ตัด',
    sources: ['SL'],
    requires: [EVIDENCE_REQUIREMENTS.AUDIT_EVENT],
    required_events: ['report_view'],
    instrument: null,
  },

  // ── AFFILIATION ───────────────────────────────────────────────────────────
  {
    key: 'affiliation.proactive_detection_rate',
    role: 'affiliation',
    title: 'Proactive Detection Rate',
    title_th: 'อัตราการตรวจพบปัญหาเชิงรุก',
    category: METRIC_CATEGORIES.RESEARCH_OUTCOME,
    formula: '(issues found by affiliation before school report) / (all issues)',
    numerator: 'ปัญหาที่สังกัดพบก่อนโรงเรียนแจ้ง',
    denominator: 'ปัญหาทั้งหมดในช่วง',
    missing_data_rule: 'ต้องมี baseline ก่อนใช้ระบบ มิฉะนั้นรายงานเป็น null',
    sources: ['SL', 'OB', 'IL'],
    requires: [EVIDENCE_REQUIREMENTS.BASELINE_PAIR],
    required_events: [],
    instrument: 'MIE-6',
  },
  {
    key: 'affiliation.alert_to_view_latency',
    role: 'affiliation',
    title: 'Alert-to-View Latency',
    title_th: 'ระยะเวลาจากการแจ้งเตือนถึงการเปิดดู',
    category: METRIC_CATEGORIES.OPERATIONAL_KPI,
    formula: 'median(view_time - alert_time)',
    numerator: 'ผลต่างเวลาแจ้งเตือนกับเวลาเปิดดูครั้งแรก',
    denominator: 'จำนวนการแจ้งเตือน',
    missing_data_rule: 'การแจ้งเตือนที่ไม่เคยถูกเปิดดูต้องรายงานแยกเป็น never_viewed ห้ามตัดทิ้งเงียบ',
    sources: ['SL', 'AL'],
    requires: [EVIDENCE_REQUIREMENTS.AUDIT_EVENT],
    required_events: ['alert_view'],
    instrument: 'DME-6',
  },
  {
    key: 'affiliation.proactive_follow_up_actions',
    role: 'affiliation',
    title: 'Proactive Follow-up Actions',
    title_th: 'การติดตามและปิดเรื่องเชิงรุก',
    category: METRIC_CATEGORIES.PARTICIPATION_KPI,
    formula: '(cases reaching FEEDBACK_SENT) / (cases raised to affiliation)',
    numerator: 'participation case ที่ปิด feedback loop ครบ',
    denominator: 'participation case ที่ส่งถึงสังกัด',
    missing_data_rule: 'case ที่ยังไม่ถึงกำหนด SLA ต้องแยกรายงาน ไม่นับเป็นล้มเหลว',
    sources: ['IV', 'AL'],
    requires: [EVIDENCE_REQUIREMENTS.AUDIT_EVENT],
    required_events: ['participation_case'],
    instrument: 'MIE-6',
  },
  {
    key: 'affiliation.pending_school_follow_up_rate',
    role: 'affiliation',
    title: 'Pending School Follow-up Rate',
    title_th: 'สัดส่วนโรงเรียนที่ยังค้างการติดตาม',
    category: METRIC_CATEGORIES.PARTICIPATION_KPI,
    formula: '(schools with open follow-up beyond SLA) / (schools in scope)',
    numerator: 'โรงเรียนที่มีงานค้างเกิน SLA',
    denominator: 'โรงเรียนในสังกัด',
    missing_data_rule: 'โรงเรียนที่ inactive ต้องถูกตัดออกจากตัวส่วนและรายงานจำนวนที่ตัด',
    sources: ['SL', 'AL'],
    requires: [EVIDENCE_REQUIREMENTS.AUDIT_EVENT, EVIDENCE_REQUIREMENTS.SYSTEM_SNAPSHOT],
    required_events: ['participation_case'],
    instrument: null,
  },

  // ── SCHOOL ────────────────────────────────────────────────────────────────
  {
    key: 'school.data_completeness_rate',
    role: 'school',
    title: 'Data Completeness Rate',
    title_th: 'ความครบถ้วนของข้อมูลนักเรียน',
    category: METRIC_CATEGORIES.OPERATIONAL_KPI,
    formula: 'students_with_vehicle / total_students',
    numerator: 'daily_snapshots.students_with_vehicle',
    denominator: 'daily_snapshots.total_students',
    missing_data_rule: 'total_students = 0 ให้รายงาน null ห้ามรายงาน 0%',
    sources: ['SL'],
    requires: [EVIDENCE_REQUIREMENTS.SYSTEM_SNAPSHOT],
    required_events: [],
    instrument: 'DME-6',
  },
  {
    key: 'school.timeliness_of_data_entry',
    role: 'school',
    title: 'Timeliness of Data Entry',
    title_th: 'ความทันเวลาในการบันทึกข้อมูล',
    category: METRIC_CATEGORIES.OPERATIONAL_KPI,
    formula: 'median(hours between event date and audit_logs.created_at)',
    numerator: 'ผลต่างเวลาเหตุการณ์กับเวลาบันทึก',
    denominator: 'จำนวนรายการที่บันทึก',
    missing_data_rule: 'รายการที่นำเข้าแบบ batch ต้องแยกออกจากการบันทึกรายวัน',
    sources: ['SL', 'AL'],
    requires: [EVIDENCE_REQUIREMENTS.SYSTEM_SNAPSHOT],
    required_events: [],
    instrument: null,
  },
  {
    key: 'school.correction_rate',
    role: 'school',
    title: 'Correction Rate',
    title_th: 'อัตราการแก้ไขข้อมูลย้อนหลัง',
    category: METRIC_CATEGORIES.OPERATIONAL_KPI,
    formula: 'count(UPDATE within 7d of CREATE) / count(CREATE)',
    numerator: 'audit_logs UPDATE ที่เกิดหลัง CREATE ภายใน 7 วัน',
    denominator: 'audit_logs CREATE ของ entity เดียวกัน',
    missing_data_rule: 'การแก้ไขจาก import rollback ต้องถูกตัดออกและรายงานแยก',
    sources: ['AL'],
    requires: [EVIDENCE_REQUIREMENTS.SYSTEM_SNAPSHOT],
    required_events: [],
    instrument: 'MIE-6',
  },
  {
    key: 'school.work_burden_reduction',
    role: 'school',
    title: 'Work Burden Reduction',
    title_th: 'ภาระงานที่ลดลง',
    category: METRIC_CATEGORIES.EXTERNAL_EVIDENCE,
    formula: '(baseline minutes/day - post minutes/day) / baseline minutes/day',
    numerator: 'ผลต่างเวลาทำงานต่อวันจาก workload diary',
    denominator: 'เวลาทำงานต่อวันช่วง baseline',
    missing_data_rule: 'ต้องมี diary ทั้งช่วง pre และ post ของผู้ตอบคนเดียวกัน มิฉะนั้นตัดผู้ตอบนั้นออก',
    sources: ['QN', 'IV', 'WL'],
    requires: [EVIDENCE_REQUIREMENTS.EXTERNAL_INSTRUMENT, EVIDENCE_REQUIREMENTS.BASELINE_PAIR],
    required_events: [],
    instrument: 'DME-6',
  },

  // ── DRIVER ────────────────────────────────────────────────────────────────
  {
    key: 'driver.pre_departure_checkin_rate',
    role: 'driver',
    title: 'Pre-departure Check-in Rate',
    title_th: 'อัตราการตรวจก่อนออกรถ',
    category: METRIC_CATEGORIES.OPERATIONAL_KPI,
    formula: 'trips with pretrip checklist / total trips',
    numerator: 'pretrip_checklist ที่บันทึกก่อนออกเดินทาง',
    denominator: 'จำนวนรอบเดินรถทั้งหมด',
    missing_data_rule: 'วันหยุดหรือวันไม่มีรอบต้องถูกตัดออกจากตัวส่วน',
    sources: ['SL'],
    requires: [EVIDENCE_REQUIREMENTS.SYSTEM_SNAPSHOT],
    required_events: [],
    instrument: 'DME-6',
  },
  {
    key: 'driver.completion_consistency',
    role: 'driver',
    title: 'Completion Consistency',
    title_th: 'ความสม่ำเสมอของการรับ-ส่งครบ',
    category: METRIC_CATEGORIES.OPERATIONAL_KPI,
    formula: '(morning_done + evening_done) / (morning_total + evening_total)',
    numerator: 'daily_snapshots.morning_done + evening_done',
    denominator: 'daily_snapshots.morning_total + evening_total',
    missing_data_rule: 'ตัวส่วน 0 ให้รายงาน null',
    sources: ['SL'],
    requires: [EVIDENCE_REQUIREMENTS.SYSTEM_SNAPSHOT],
    required_events: [],
    instrument: null,
  },
  {
    key: 'driver.usage_continuity_streak',
    role: 'driver',
    title: 'Usage Continuity (Streak)',
    title_th: 'ความต่อเนื่องของการใช้งาน',
    category: METRIC_CATEGORIES.OPERATIONAL_KPI,
    formula: 'median(consecutive operating days with at least one check-in per driver)',
    numerator: 'จำนวนวันทำการต่อเนื่องที่มีการเช็กอิน',
    denominator: 'จำนวนวันทำการในช่วง',
    missing_data_rule: 'คนขับที่เริ่มใช้งานกลางช่วงต้องนับจากวันแรกที่ใช้งานจริง',
    sources: ['SL'],
    requires: [EVIDENCE_REQUIREMENTS.SYSTEM_SNAPSHOT],
    required_events: [],
    instrument: 'MIE-6',
  },
  {
    key: 'driver.ux_satisfaction_elderly',
    role: 'driver',
    title: 'UX Satisfaction (Elderly-friendly)',
    title_th: 'ความพึงพอใจการใช้งานสำหรับผู้สูงอายุ',
    category: METRIC_CATEGORIES.EXTERNAL_EVIDENCE,
    formula: 'mean(Likert score) from driver UX questionnaire',
    numerator: 'ผลรวมคะแนนความพึงพอใจ',
    denominator: 'จำนวนผู้ตอบที่ตอบครบ',
    missing_data_rule: 'แบบสอบถามที่ตอบไม่ครบข้อบังคับต้องถูกตัดออกและรายงานอัตราการตอบกลับ',
    sources: ['QN'],
    requires: [EVIDENCE_REQUIREMENTS.EXTERNAL_INSTRUMENT],
    required_events: [],
    instrument: 'DME-6',
  },

  // ── TRANSPORT ─────────────────────────────────────────────────────────────
  {
    key: 'transport.risk_closure_within_sla',
    role: 'transport',
    title: 'Risk Closure within SLA',
    title_th: 'อัตราการปิดความเสี่ยงภายใน SLA',
    category: METRIC_CATEGORIES.OPERATIONAL_KPI,
    formula: '(risks closed within SLA) / (risks opened)',
    numerator: 'ความเสี่ยงที่ปิดภายใน SLA',
    denominator: 'ความเสี่ยงที่เปิดในช่วง',
    missing_data_rule: 'รายการที่ยังไม่ถึงกำหนด SLA ต้องแยกเป็น in_progress ไม่นับว่าเกิน SLA',
    sources: ['SL'],
    requires: [EVIDENCE_REQUIREMENTS.SYSTEM_SNAPSHOT, EVIDENCE_REQUIREMENTS.AUDIT_EVENT],
    required_events: ['risk_closure'],
    instrument: 'MIE-6',
  },
  {
    key: 'transport.non_recurrence_rate',
    role: 'transport',
    title: 'Non-recurrence Rate',
    title_th: 'อัตราที่ปัญหาไม่กลับมาเกิดซ้ำ',
    category: METRIC_CATEGORIES.RESEARCH_OUTCOME,
    formula: '(closed risks not reopened within 90d) / (closed risks)',
    numerator: 'ความเสี่ยงที่ปิดแล้วไม่กลับมาใน 90 วัน',
    denominator: 'ความเสี่ยงที่ปิดในช่วง',
    missing_data_rule: 'ต้องมีช่วงสังเกต 90 วันเต็มหลังปิด มิฉะนั้นตัดออกจากตัวส่วน',
    sources: ['SL'],
    requires: [EVIDENCE_REQUIREMENTS.BASELINE_PAIR, EVIDENCE_REQUIREMENTS.AUDIT_EVENT],
    required_events: ['risk_closure'],
    instrument: null,
  },
  {
    key: 'transport.unresolved_risk_volume',
    role: 'transport',
    title: 'Unresolved Risk Volume',
    title_th: 'ปริมาณความเสี่ยงที่ยังไม่ปิด',
    category: METRIC_CATEGORIES.OPERATIONAL_KPI,
    formula: 'count(open risks at period end)',
    numerator: 'ความเสี่ยงสถานะเปิด ณ สิ้นช่วง',
    denominator: '-',
    missing_data_rule: 'เป็นค่านับ ไม่มีตัวส่วน ห้ามแปลงเป็นเปอร์เซ็นต์โดยไม่ระบุฐาน',
    sources: ['SL'],
    requires: [EVIDENCE_REQUIREMENTS.SYSTEM_SNAPSHOT],
    required_events: [],
    instrument: 'DME-6',
  },
  {
    key: 'transport.time_to_close_risk',
    role: 'transport',
    title: 'Time-to-Close Risk',
    title_th: 'ระยะเวลาปิดความเสี่ยง',
    category: METRIC_CATEGORIES.OPERATIONAL_KPI,
    formula: 'median(close_time - open_time)',
    numerator: 'ผลต่างเวลาเปิดและปิดความเสี่ยง',
    denominator: 'จำนวนความเสี่ยงที่ปิดแล้ว',
    missing_data_rule: 'ความเสี่ยงที่ยังไม่ปิดต้องรายงานแยกเป็น censored ห้ามใส่ค่า 0',
    sources: ['SL'],
    requires: [EVIDENCE_REQUIREMENTS.AUDIT_EVENT],
    required_events: ['risk_closure'],
    instrument: null,
  },

  // ── ADMIN ─────────────────────────────────────────────────────────────────
  {
    key: 'admin.active_account_rate',
    role: 'admin',
    title: 'Active Account Rate',
    title_th: 'สัดส่วนบัญชีที่ใช้งานจริง',
    category: METRIC_CATEGORIES.OPERATIONAL_KPI,
    formula: 'active_users / total_users',
    numerator: 'daily_snapshots.active_users',
    denominator: 'daily_snapshots.total_users',
    missing_data_rule: 'บัญชีที่ถูกลบต้องไม่อยู่ในตัวส่วน',
    sources: ['SL'],
    requires: [EVIDENCE_REQUIREMENTS.SYSTEM_SNAPSHOT],
    required_events: [],
    instrument: 'DME-6',
  },
  {
    key: 'admin.password_reset_frequency',
    role: 'admin',
    title: 'Password Reset Frequency',
    title_th: 'ความถี่ในการรีเซ็ตรหัสผ่าน',
    category: METRIC_CATEGORIES.OPERATIONAL_KPI,
    formula: 'count(password reset events) / count(active users) per month',
    numerator: 'audit_logs entity_type = password',
    denominator: 'จำนวนบัญชีที่ใช้งานในเดือนนั้น',
    missing_data_rule: 'การรีเซ็ตของบัญชีทดสอบต้องถูกตัดออก',
    sources: ['AL'],
    requires: [EVIDENCE_REQUIREMENTS.SYSTEM_SNAPSHOT],
    required_events: [],
    instrument: null,
  },
  {
    key: 'admin.onboarding_issue_rate',
    role: 'admin',
    title: 'Onboarding Issue Rate',
    title_th: 'อัตราปัญหาช่วงเริ่มใช้งาน',
    category: METRIC_CATEGORIES.RESEARCH_OUTCOME,
    formula: '(users reporting an onboarding issue) / (users onboarded)',
    numerator: 'ผู้ใช้ที่แจ้งปัญหาช่วงเริ่มใช้งาน',
    denominator: 'ผู้ใช้ที่เริ่มใช้งานในช่วง',
    missing_data_rule: 'ผู้ใช้ที่ไม่ได้ถูกสัมภาษณ์ต้องไม่นับว่าไม่มีปัญหา',
    sources: ['AL', 'IV'],
    requires: [EVIDENCE_REQUIREMENTS.EXTERNAL_INSTRUMENT],
    required_events: [],
    instrument: 'MIE-6',
  },
  {
    key: 'admin.data_health_score',
    role: 'admin',
    title: 'Data Health Score',
    title_th: 'คะแนนสุขภาพข้อมูล',
    category: METRIC_CATEGORIES.OPERATIONAL_KPI,
    formula: 'weighted mean(completeness, duplicate-free, orphan-free, expiry-valid)',
    numerator: 'ผลรวมถ่วงน้ำหนักของ sub-score',
    denominator: 'ผลรวมน้ำหนัก',
    missing_data_rule: 'sub-score ที่คำนวณไม่ได้ต้องถูกตัดออกจากทั้งตัวตั้งและน้ำหนัก',
    sources: ['SL'],
    requires: [EVIDENCE_REQUIREMENTS.SYSTEM_SNAPSHOT, EVIDENCE_REQUIREMENTS.AUDIT_EVENT],
    required_events: ['integrity_monitor'],
    instrument: 'DME-6',
  },
]);

const ROLES_WITH_METRICS = Object.freeze([...new Set(METRICS.map((m) => m.role))]);

function metricsForRole(role) {
  return METRICS.filter((m) => m.role === role);
}

function metricsByCategory(category) {
  return METRICS.filter((m) => m.category === category);
}

function getMetric(key) {
  return METRICS.find((m) => m.key === key) || null;
}

module.exports = {
  METRIC_CATEGORIES,
  EVIDENCE_REQUIREMENTS,
  EVIDENCE_STATUS,
  EVIDENCE_STATUS_LABEL_TH,
  SNAPSHOT_FRESHNESS_MAX_AGE_DAYS,
  MIN_BASELINE_POST_GAP_DAYS,
  METRICS,
  ROLES_WITH_METRICS,
  metricsForRole,
  metricsByCategory,
  getMetric,
};
