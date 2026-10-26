/**
 * Evidence status vocabulary, mirrored from
 * `backend/src/config/researchMetrics.js`.
 *
 * The old client-side rule — 20 raw audit actions plus any snapshot means
 * "พร้อมประเมิน" — let repeated logins and bulk imports make a role look ready
 * to evaluate. Readiness is now computed on the server from what each metric
 * actually requires, and this module only renders the answer.
 *
 * There is deliberately no status here that means "ready to evaluate". The
 * best a role can reach from system data alone is "มีหลักฐานระบบเบื้องต้น";
 * anything beyond that needs a frozen protocol and a Research lead signature.
 */

export const EVIDENCE_STATUS = {
  SYSTEM_EVIDENCE: 'system_evidence',
  PARTIAL: 'partial_evidence',
  MISSING: 'evidence_missing',
};

export const EVIDENCE_STATUS_META = {
  [EVIDENCE_STATUS.SYSTEM_EVIDENCE]: { label: 'มีหลักฐานระบบเบื้องต้น', variant: 'success', cls: 'bg-green-100 text-green-700', level: 2 },
  [EVIDENCE_STATUS.PARTIAL]: { label: 'มีหลักฐานบางส่วน', variant: 'warn', cls: 'bg-amber-100 text-amber-700', level: 1 },
  [EVIDENCE_STATUS.MISSING]: { label: 'ยังไม่มีหลักฐานพอ', variant: 'danger', cls: 'bg-red-100 text-red-700', level: 0 },
};

const UNKNOWN = { label: 'ยังไม่ทราบสถานะหลักฐาน', variant: 'neutral', cls: 'bg-gray-100 text-gray-600', level: 0 };

/**
 * Render metadata for one role's coverage row.
 * An older backend that does not send `evidence_readiness` yields "unknown"
 * rather than a guess — an absent answer must not read as a positive one.
 */
export function roleEvidenceMeta(roleCoverage) {
  if (!roleCoverage || !roleCoverage.status) return UNKNOWN;
  return EVIDENCE_STATUS_META[roleCoverage.status] || UNKNOWN;
}

/** Human-readable reason codes from the readiness service. */
export const BLOCKING_REASON_TH = {
  research_protocol_not_frozen: 'ยังไม่ freeze research protocol',
  research_lead_signoff_missing: 'ยังไม่มีการรับรองโดย Research lead',
  snapshot_stale: 'snapshot ล่าสุดเก่าเกินเกณฑ์',
  no_snapshot: 'ยังไม่มี snapshot',
  no_baseline_snapshot: 'ยังไม่มี baseline snapshot',
  no_post_snapshot: 'ยังไม่มี snapshot หลัง baseline',
  no_baseline_pair: 'ยังไม่มีคู่ baseline/post',
  observation_period_too_short: 'ช่วงสังเกตสั้นเกินไป',
  baseline_outside_protocol_window: 'baseline อยู่นอกช่วง protocol',
  post_outside_protocol_window: 'ข้อมูลหลัง baseline อยู่นอกช่วง protocol',
  missing_external_evidence: 'ยังไม่มีหลักฐานภายนอก',
  external_evidence_unversioned: 'หลักฐานภายนอกไม่ระบุเวอร์ชันเครื่องมือ',
  metrics_without_evidence: 'มีตัวชี้วัดที่ยังไม่มีหลักฐาน',
};

export function describeBlockingReason(reason) {
  if (!reason) return '';
  if (BLOCKING_REASON_TH[reason]) return BLOCKING_REASON_TH[reason];
  if (reason.startsWith('missing_audit_events:')) {
    return `ยังไม่มี event: ${reason.slice('missing_audit_events:'.length).split('|').join(', ')}`;
  }
  return reason;
}
