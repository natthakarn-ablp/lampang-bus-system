/**
 * Driver session utilities.
 *
 * Business rules:
 *   morning (before switch hour) = driver drops students OFF at school = "ส่งเช้า"
 *   evening (switch hour onward) = driver picks students UP from school = "รับเย็น"
 *
 * Source-of-truth priority:
 *   1. current_session returned by GET /api/driver/status-today (server-side Bangkok time)
 *   2. Fallback: local browser hour vs VITE_DRIVER_SESSION_SWITCH_HOUR
 *
 * Backend session values ('morning' / 'evening') are unchanged throughout.
 */

/** Fallback switch hour from Vite env (defaults to 12 if not set). */
const SWITCH_HOUR = parseInt(import.meta.env.VITE_DRIVER_SESSION_SWITCH_HOUR ?? '12', 10);

/**
 * Derive the active session from the current LOCAL browser time.
 * Use only as a fallback when the backend response is unavailable.
 *
 * @returns {'morning' | 'evening'}
 */
export function getActiveSession() {
  return new Date().getHours() < SWITCH_HOUR ? 'morning' : 'evening';
}

/**
 * Resolve the session to use, preferring the server-provided value.
 *
 * @param {string|null|undefined} serverSession - current_session from status-today API
 * @returns {'morning' | 'evening'}
 */
export function resolveSession(serverSession) {
  if (serverSession === 'morning' || serverSession === 'evening') return serverSession;
  return getActiveSession(); // fallback to browser time
}

/** Thai display label for each session mode. */
export const SESSION_LABEL = {
  morning: 'ส่งเช้า',
  evening: 'รับเย็น',
};

/** Per-student action button label. */
export const ACTION_LABEL = {
  morning: 'ส่งถึงโรงเรียน',
  evening: 'รับกลับบ้าน',
};

/** Bulk action button label. */
export const BULK_LABEL = {
  morning: 'ส่งเช้าทั้งหมด',
  evening: 'รับเย็นทั้งหมด',
};

/** Graceful "all done" label for bulk button area. */
export const ALL_DONE_LABEL = {
  morning: 'ส่งเช้าครบแล้ว',
  evening: 'รับเย็นครบแล้ว',
};

/** Summary card label. */
export const DONE_LABEL = {
  morning: 'ส่งเช้าแล้ว',
  evening: 'รับเย็นแล้ว',
};

/** Recent-activity session tag. */
export const SESSION_TAG = {
  morning: 'ส่งเช้า',
  evening: 'รับเย็น',
};
