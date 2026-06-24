'use strict';

const ACTIONABLE_STATUSES = new Set(['WARN', 'CRITICAL']);
const SENSITIVE_RE = /token|secret|password|credential|authorization|phone|เบอร์|โทร/i;
const PHONE_RE = /\b0[689]\d{8}\b/g;
const SECRET_ASSIGNMENT_RE = /\b[A-Z0-9_]*(TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL)[A-Z0-9_]*\s*[:=]\s*\S+/gi;

function hasSensitiveValue(value) {
  const text = String(value ?? '');
  return SENSITIVE_RE.test(text) || PHONE_RE.test(text) || SECRET_ASSIGNMENT_RE.test(text);
}

function sanitize(value) {
  const text = String(value ?? '-');
  if (hasSensitiveValue(text)) return '[redacted]';
  return text
    .replace(PHONE_RE, '[redacted]')
    .replace(SECRET_ASSIGNMENT_RE, '[redacted]')
    .slice(0, 240);
}

async function deliverOperationsAlert(report, { webhookUrl = process.env.ALERT_LINE_WEBHOOK_URL } = {}) {
  const status = String(report?.status || '').toUpperCase();
  if (!ACTIONABLE_STATUSES.has(status)) {
    return { delivered: false, reason: 'not_actionable' };
  }
  if (!webhookUrl) {
    return { delivered: false, reason: 'disabled' };
  }

  const lines = [`Lampang Bus: ${status}`];
  for (const check of (report.checks || [])) {
    const severity = String(check?.severity || '').toUpperCase();
    if (!ACTIONABLE_STATUSES.has(severity)) continue;
    lines.push(`${severity} ${sanitize(check.label)}: ${sanitize(check.value)}`);
    if (lines.length >= 9) break;
  }

  const body = JSON.stringify({ text: lines.join('\n').slice(0, 1800) });
  const timeout = global.AbortSignal?.timeout ? { signal: AbortSignal.timeout(5000) } : {};
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    ...timeout,
  });
  if (!response.ok) throw new Error(`alert HTTP ${response.status}`);
  return { delivered: true };
}

module.exports = { deliverOperationsAlert, sanitize };
