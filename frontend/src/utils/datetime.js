/**
 * Compact Thai relative-time formatter.
 *
 * Used in tight UI spots like AttentionCard secondary lines where the full
 * absolute datetime (e.g. "10 พ.ค. 03:40") would be too verbose. For longer
 * incident-feed rows, prefer the absolute datetime via toLocaleString.
 *
 * Returns "-" for null/undefined input so callers don't have to guard.
 */
export function relativeTime(iso) {
  if (!iso) return '-';
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60)    return `${sec} วินาทีก่อน`;
  if (sec < 3600)  return `${Math.floor(sec / 60)} นาทีก่อน`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ชั่วโมงก่อน`;
  return `${Math.floor(sec / 86400)} วันก่อน`;
}
