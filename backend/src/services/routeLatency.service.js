'use strict';

// PII-free, process-local latency histograms for operator API routes. Never
// record the requested URL, params, query string, user ID, IP or response body.
// Counters reset on process restart; subtract successive snapshots for a peak
// window rather than treating the lifetime totals as a capacity measurement.
const STARTED_AT = new Date().toISOString();
const BUCKET_UPPER_MS = Object.freeze([25, 50, 100, 250, 500, 1000, 2000, 5000, 10000]);
const MAX_KEYS = 512;
const ROLE_SET = new Set(['school', 'affiliation', 'admin', 'driver', 'province', 'transport']);
const PREFIX_SET = new Set([
  'school', 'affiliation', 'admin', 'driver', 'province', 'transport', 'reports', 'verification',
]);
const ROUTE_TEMPLATE = /^\/[a-zA-Z0-9_/:.-]*$/;
const counters = new Map();
let overflow = 0;

function fixedPrefix(path) {
  const match = /^\/api\/([a-z-]+)(?:\/|$)/.exec(String(path || ''));
  return match && PREFIX_SET.has(match[1]) ? `/api/${match[1]}` : null;
}

function routeLabel(req, prefix) {
  const pattern = req.route && req.route.path;
  // Express route.path comes from source definitions, never from the request.
  // Unknown/missing patterns get a fixed label instead of a raw URL fallback.
  return typeof pattern === 'string' && pattern.length <= 120 && ROUTE_TEMPLATE.test(pattern)
    ? `${prefix}${pattern}`
    : `${prefix}/_unclassified`;
}

function record(req, statusCode, durationMs) {
  const prefix = fixedPrefix(req.path || req.originalUrl);
  if (!prefix) return;
  const role = ROLE_SET.has(req.user && req.user.role) ? req.user.role : 'unattributed';
  const method = /^[A-Z]{2,8}$/.test(req.method) ? req.method : 'OTHER';
  const route = routeLabel(req, prefix);
  const key = `${role}|${method}|${route}`;
  let entry = counters.get(key);
  if (!entry) {
    if (counters.size >= MAX_KEYS) { overflow++; return; }
    entry = {
      role, method, route, count: 0,
      status_2xx: 0, status_3xx: 0, status_4xx: 0, status_5xx: 0,
      status_429: 0, aborted: 0, duration_sum_ms: 0, duration_max_ms: 0,
      histogram: Array(BUCKET_UPPER_MS.length + 1).fill(0),
    };
    counters.set(key, entry);
  }
  const ms = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
  entry.count++;
  if (statusCode === 0) { entry.aborted++; return; }
  entry.duration_sum_ms += ms;
  entry.duration_max_ms = Math.max(entry.duration_max_ms, ms);
  if (statusCode === 429) { entry.status_429++; entry.status_4xx++; }
  else if (statusCode >= 500) entry.status_5xx++;
  else if (statusCode >= 400) entry.status_4xx++;
  else if (statusCode >= 300) entry.status_3xx++;
  else entry.status_2xx++;
  const bucket = BUCKET_UPPER_MS.findIndex((upper) => ms <= upper);
  entry.histogram[bucket === -1 ? BUCKET_UPPER_MS.length : bucket]++;
}

function routeLatencyMiddleware(req, res, next) {
  // Path is used only to test membership in a fixed allowlist. It is never
  // retained or emitted. Avoid even a timer for the public SPA/LINE/parent API.
  if (!fixedPrefix(req.path || req.originalUrl)) return next();
  const started = process.hrtime.bigint();
  let completed = false;
  const finish = (status) => {
    if (completed) return;
    completed = true;
    record(req, status, Number(process.hrtime.bigint() - started) / 1e6);
  };
  res.once('finish', () => finish(res.statusCode));
  res.once('close', () => finish(res.writableEnded ? res.statusCode : 0));
  next();
}

function snapshot() {
  return {
    process_started_at: STARTED_AT,
    captured_at: new Date().toISOString(),
    histogram_upper_ms: BUCKET_UPPER_MS,
    overflow_count: overflow,
    routes: Array.from(counters.values(), (entry) => ({
      ...entry,
      served_count: entry.count - entry.aborted,
      duration_sum_ms: Math.round(entry.duration_sum_ms),
      duration_max_ms: Math.round(entry.duration_max_ms),
      histogram: [...entry.histogram],
    })),
    limitations: ['process_local', 'cumulative_since_process_start', 'histogram_bucketed', 'histogram_excludes_aborted', 'unattributed_includes_pre_auth_rejections'],
  };
}

module.exports = { routeLatencyMiddleware, snapshot };
