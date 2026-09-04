'use strict';

/**
 * Validation for province/admin decision logs.
 *
 * A decision log is the only structured evidence the system has that a report
 * informed a decision, so a participatory-administration claim would rest on
 * it. The endpoint used to accept any decision_type, an unbounded note and an
 * arbitrary report_date, writing all of it straight into audit_logs.new_value:
 * free-text types cannot be aggregated, and an unbounded note is unbounded
 * storage in an append-only table. Everything is validated against an
 * allowlist with explicit limits.
 *
 * Kept out of the route module so unit tests can exercise it without a
 * database or an Express app.
 */

const DECISION_TYPES = Object.freeze(['follow_up', 'action_needed', 'info_only', 'escalate']);
const DECISION_REPORT_TYPES = Object.freeze(['daily', 'monthly', 'summary', 'policy']);
const DECISION_NOTE_MAX = 500;

/** Roles whose decisions the framework counts. Others get 403, not a silent drop. */
const DECISION_LOG_ROLES = Object.freeze(['province', 'admin']);

/** Decision types that are meaningless without a stated reason. */
const NOTE_REQUIRED_TYPES = Object.freeze(['action_needed', 'escalate']);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year) {
  return (year % 400 === 0) || (year % 4 === 0 && year % 100 !== 0);
}

function isValidMonth(value) {
  if (!MONTH_RE.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) return false;
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day >= 1 && day <= maxDay;
}

/**
 * @returns {{value: object}|{error: string}}
 */
function validateDecisionLog(body) {
  const src = body || {};
  const decisionType = typeof src.decision_type === 'string' ? src.decision_type.trim() : '';
  const reportType = typeof src.report_type === 'string' ? src.report_type.trim() : '';
  const reportDate = typeof src.report_date === 'string' ? src.report_date.trim() : '';
  const note = src.decision_note == null ? '' : String(src.decision_note).trim();

  if (!DECISION_TYPES.includes(decisionType)) {
    return { error: `decision_type ต้องเป็นค่าใดค่าหนึ่งใน ${DECISION_TYPES.join(', ')}` };
  }
  if (!DECISION_REPORT_TYPES.includes(reportType)) {
    return { error: `report_type ต้องเป็นค่าใดค่าหนึ่งใน ${DECISION_REPORT_TYPES.join(', ')}` };
  }
  // Monthly reports are addressed by month; everything else by date.
  const dateOk = reportType === 'monthly' ? isValidMonth(reportDate) : isValidDate(reportDate);
  if (!dateOk) {
    return {
      error: reportType === 'monthly'
        ? 'report_date ต้องเป็นเดือนจริงรูปแบบ YYYY-MM'
        : 'report_date ต้องเป็นวันที่จริงรูปแบบ YYYY-MM-DD',
    };
  }
  if (note.length > DECISION_NOTE_MAX) {
    return { error: `decision_note ต้องยาวไม่เกิน ${DECISION_NOTE_MAX} ตัวอักษร` };
  }
  if (NOTE_REQUIRED_TYPES.includes(decisionType) && note.length === 0) {
    return { error: `decision_note จำเป็นเมื่อ decision_type เป็น ${NOTE_REQUIRED_TYPES.join(' หรือ ')}` };
  }

  return { value: { decisionType, reportType, reportDate, note } };
}

module.exports = {
  DECISION_TYPES,
  DECISION_REPORT_TYPES,
  DECISION_LOG_ROLES,
  DECISION_NOTE_MAX,
  NOTE_REQUIRED_TYPES,
  validateDecisionLog,
};
