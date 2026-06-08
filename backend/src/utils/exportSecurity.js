'use strict';

/**
 * exportSecurity.js (Phase 10.12G)
 *
 * Centralised helpers for safe spreadsheet/CSV export:
 *   - formula-injection neutralisation
 *   - PII masking (phone / LINE user id)
 *   - audit value redaction (old_value / new_value)
 *
 * Pure, dependency-free, and unit-tested in isolation.
 */

// Characters that make a spreadsheet app (Excel / Sheets / LibreOffice) treat a
// cell as a formula when they begin the cell. Tab and CR can smuggle a leading
// formula past naive checks, so they are included.
const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;

/**
 * Neutralise a value for safe inclusion in a spreadsheet cell (CSV or XLSX).
 * If the string form begins with a formula trigger, prefix a single quote so
 * spreadsheet apps render it as literal text. Returns a string. null/undefined
 * → '' (matches the existing export convention).
 */
function neutralizeSpreadsheetCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.length === 0) return s;
  return DANGEROUS_PREFIX.test(s) ? `'${s}` : s;
}

/**
 * Build a CSV field: neutralise against formula injection, then RFC-4180 quote
 * (wrap in double quotes; double any internal quotes). Always quoted so commas
 * and newlines are contained.
 */
function csvCell(value) {
  const n = neutralizeSpreadsheetCell(value);
  return `"${n.replace(/"/g, '""')}"`;
}

/**
 * Mask a phone number, e.g. 0901234567 → 090****567.
 * Empty → ''; too short to partially reveal → '****'.
 */
function maskPhone(phone) {
  if (phone === null || phone === undefined) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length < 7) return '****';
  return `${digits.slice(0, 3)}****${digits.slice(-3)}`;
}

/**
 * Mask a LINE user id (opaque 'U' + 32 hex). Never reveal it in full.
 */
function maskLineUserId(id) {
  if (id === null || id === undefined) return '';
  const s = String(id).trim();
  if (s.length === 0) return '';
  if (s.length <= 10) return '[redacted]';
  return `${s.slice(0, 8)}…[redacted]`;
}

// Keys whose values must never appear in an exported audit value.
const SENSITIVE_KEYS = new Set([
  'password', 'password_hash', 'new_password', 'current_password',
  'token', 'access_token', 'refresh_token', 'id_token', 'idtoken',
  'secret', 'channel_secret', 'line_channel_secret', 'db_password', 'jwt_secret',
  'cid', 'cid_hash',
]);
// Keys masked (rather than removed) so the audit stays reviewable.
const MASK_PHONE_KEYS = new Set(['phone', 'parent_phone', 'owner_phone', 'attendant_phone', 'driver_phone']);
const MASK_LINE_KEYS = new Set(['line_user_id', 'lineuserid', 'target_line_user_id']);

function redactObject(obj, depth) {
  if (depth > 6) return '[truncated]';
  if (Array.isArray(obj)) return obj.map((v) => redactObject(v, depth + 1));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const key = String(k).toLowerCase();
      if (SENSITIVE_KEYS.has(key)) out[k] = '[redacted]';
      else if (MASK_PHONE_KEYS.has(key)) out[k] = maskPhone(v);
      else if (MASK_LINE_KEYS.has(key)) out[k] = maskLineUserId(v);
      else if (v && typeof v === 'object') out[k] = redactObject(v, depth + 1);
      else out[k] = v;
    }
    return out;
  }
  return obj;
}

/**
 * Redact an audit old_value/new_value (JSON object or JSON string) for export.
 * Sensitive keys removed; phone / LINE ids masked; nested values handled
 * recursively. Returns a JSON STRING safe to drop into a cell. Unparseable
 * input → a placeholder (never the raw value, which may contain PII).
 */
function redactAuditValue(value) {
  if (value === null || value === undefined || value === '') return '';
  let obj = value;
  if (typeof value === 'string') {
    try { obj = JSON.parse(value); }
    catch { return '[redacted: unparseable audit value]'; }
  }
  if (typeof obj !== 'object') return String(obj);
  try { return JSON.stringify(redactObject(obj, 0)); }
  catch { return '[redacted]'; }
}

module.exports = {
  neutralizeSpreadsheetCell,
  csvCell,
  maskPhone,
  maskLineUserId,
  redactAuditValue,
};
