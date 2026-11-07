// Throttling (HTTP 429) used to surface as each page's generic
// 'โหลดข้อมูลไม่สำเร็จ' or as an empty list, so neither the user nor the trainer
// could tell "wait a moment" apart from a real outage (QA load-07). The axios
// interceptor and the raw-fetch export path both route a 429 through here, and
// the ToastProvider shows one toast with the server's own Thai message.

export const RATE_LIMIT_EVENT = 'app:rate-limited';
const FALLBACK = 'ใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่';
// A page that fires several requests at once would otherwise stack one toast
// per request.
const QUIET_MS = 8000;

function header(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

/** Seconds until the limiter resets, from Retry-After or RateLimit-Reset. */
export function retryAfterSeconds(headers) {
  for (const name of ['retry-after', 'ratelimit-reset']) {
    const n = Number(header(headers, name));
    if (Number.isFinite(n) && n > 0) return Math.ceil(n);
  }
  return null;
}

/** The toast text: the server's message plus a wait hint when known. */
export function rateLimitMessage(data, headers) {
  const base = (data && typeof data.message === 'string' && data.message.trim()) || FALLBACK;
  const secs = retryAfterSeconds(headers);
  if (!secs) return base;
  const wait = secs >= 60 ? `${Math.ceil(secs / 60)} นาที` : `${secs} วินาที`;
  return `${base} (ลองใหม่ได้ในอีกประมาณ ${wait})`;
}

let lastAt = 0;

/** Announce a 429 once per quiet window. Returns true when an event was sent. */
export function notifyRateLimited(data, headers, now = Date.now()) {
  if (now - lastAt < QUIET_MS) return false;
  lastAt = now;
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return false;
  window.dispatchEvent(new CustomEvent(RATE_LIMIT_EVENT, { detail: { message: rateLimitMessage(data, headers) } }));
  return true;
}

/** Test hook. */
export function resetRateLimitNotice() {
  lastAt = 0;
}
