import { useEffect, useRef, useState } from 'react';
import { MapPin, Navigation, OctagonAlert } from 'lucide-react';
import api from '../api/axios';
import { AppCard, AlertBanner, StatusBadge } from './ui';

/**
 * Phase 7.3 — Driver location sender.
 *
 * Hard guarantees:
 *   • starts OFF on every page load (no localStorage / sessionStorage)
 *   • does NOT call navigator.geolocation before the user taps Start
 *   • single watchPosition; cleared on Stop / unmount / beforeunload
 *   • Stop calls DELETE /driver/vehicle-location to flip backend status=PAUSED
 *   • POST throttle: send when ≥15s have passed OR distance moved >30m
 *   • never includes vehicle_id in the body — backend resolves from JWT
 *   • never logs full lat/lng (privacy)
 */

const SEND_MIN_INTERVAL_MS = 15_000;
const SEND_MIN_DISTANCE_M  = 30;

const STATUS = {
  idle:                  { variant: 'neutral', label: 'ยังไม่ได้ส่งตำแหน่ง' },
  requesting_permission: { variant: 'info',    label: 'กำลังขออนุญาตตำแหน่ง' },
  sending:               { variant: 'success', label: 'กำลังส่งตำแหน่ง' },
  permission_denied:     { variant: 'danger',  label: 'ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง' },
  position_unavailable:  { variant: 'warn',    label: 'ไม่พบสัญญาณตำแหน่ง' },
  timeout:               { variant: 'warn',    label: 'ใช้เวลาค้นหาตำแหน่งนานเกินไป' },
  network_error:         { variant: 'warn',    label: 'ส่งตำแหน่งไม่สำเร็จ' },
  stopped:               { variant: 'neutral', label: 'หยุดส่งตำแหน่งแล้ว' },
};

// Haversine distance in meters (for the throttle/distance gate only — never logged).
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export default function LiveLocationToggle() {
  const [status, setStatus]         = useState('idle');
  const [lastSentAt, setLastSentAt] = useState(null);   // Date | null (UI display only)
  const [accuracy, setAccuracy]     = useState(null);   // meters
  const [errorMsg, setErrorMsg]     = useState(null);   // detail string for danger banner

  // Refs avoid stale-closure issues inside watchPosition callbacks
  const watchIdRef       = useRef(null);
  const lastSentRef      = useRef({ ts: 0, lat: null, lng: null });
  const isSendingRef     = useRef(false);              // tracks whether toggle is ON
  const beforeUnloadRef  = useRef(null);

  const isOn = status === 'sending' || status === 'requesting_permission'
            || status === 'position_unavailable' || status === 'timeout'
            || status === 'network_error';

  /* ── send helpers ───────────────────────────────────────────────────────── */

  const postPosition = async (coords, recordedAt) => {
    try {
      await api.post('/driver/vehicle-location', {
        latitude:        coords.latitude,
        longitude:       coords.longitude,
        accuracy_meters: coords.accuracy != null ? Math.round(coords.accuracy) : null,
        speed_mps:       Number.isFinite(coords.speed)   ? coords.speed   : null,
        heading_deg:     Number.isFinite(coords.heading) ? coords.heading : null,
        recorded_at:     recordedAt,
      });
      lastSentRef.current = { ts: Date.now(), lat: coords.latitude, lng: coords.longitude };
      setLastSentAt(new Date());
      setAccuracy(coords.accuracy != null ? Math.round(coords.accuracy) : null);
      // Recover from a previous transient error
      if (isSendingRef.current) setStatus('sending');
      setErrorMsg(null);
    } catch (err) {
      // Network/server failure — keep watching but flag a retry-on-next-tick state
      if (isSendingRef.current) {
        setStatus('network_error');
        setErrorMsg(err?.response?.data?.message || 'ส่งตำแหน่งไม่สำเร็จ จะลองใหม่ในรอบถัดไป');
      }
    }
  };

  const onPosition = (pos) => {
    if (!isSendingRef.current) return;       // race: user may have stopped
    const c = pos.coords;
    const now = Date.now();
    const last = lastSentRef.current;
    const moved = (last.lat == null || last.lng == null)
      ? Infinity
      : getDistanceMeters(last.lat, last.lng, c.latitude, c.longitude);
    const aged = now - last.ts;
    if (last.ts !== 0 && aged < SEND_MIN_INTERVAL_MS && moved < SEND_MIN_DISTANCE_M) {
      // Still within throttle window AND hasn't moved enough — skip POST
      return;
    }
    const recordedAt = new Date(pos.timestamp || now).toISOString();
    postPosition(c, recordedAt);
  };

  const onPositionError = (err) => {
    if (!isSendingRef.current) return;
    if (err.code === err.PERMISSION_DENIED) {
      // Hard stop — clear watch immediately and require re-tap to retry
      stopInternal();
      setStatus('permission_denied');
      setErrorMsg('กรุณาอนุญาตการเข้าถึงตำแหน่งในเบราว์เซอร์ เพื่อส่งตำแหน่งรถขณะปฏิบัติงาน');
      return;
    }
    if (err.code === err.POSITION_UNAVAILABLE) {
      setStatus('position_unavailable');
      setErrorMsg('ไม่พบสัญญาณตำแหน่ง — ระบบจะลองใหม่อัตโนมัติ');
      return;
    }
    if (err.code === err.TIMEOUT) {
      setStatus('timeout');
      setErrorMsg('ใช้เวลาค้นหาตำแหน่งนานเกินไป — ระบบจะลองใหม่อัตโนมัติ');
      return;
    }
  };

  /* ── start / stop ───────────────────────────────────────────────────────── */

  const start = () => {
    if (isSendingRef.current) return;
    if (!('geolocation' in navigator)) {
      setStatus('permission_denied');
      setErrorMsg('เบราว์เซอร์นี้ไม่รองรับการเข้าถึงตำแหน่ง');
      return;
    }
    isSendingRef.current = true;
    setStatus('requesting_permission');
    setErrorMsg(null);
    lastSentRef.current = { ts: 0, lat: null, lng: null };

    watchIdRef.current = navigator.geolocation.watchPosition(
      onPosition,
      onPositionError,
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );

    // Cleanup hook for tab close — clears watch synchronously (privacy first)
    beforeUnloadRef.current = () => {
      if (watchIdRef.current != null) {
        try { navigator.geolocation.clearWatch(watchIdRef.current); } catch { /* noop */ }
        watchIdRef.current = null;
      }
      // Best-effort: ask backend to mark PAUSED; no sendBeacon, no retries.
      try { api.delete('/driver/vehicle-location'); } catch { /* noop */ }
    };
    window.addEventListener('beforeunload', beforeUnloadRef.current);
  };

  const stopInternal = () => {
    isSendingRef.current = false;
    if (watchIdRef.current != null) {
      try { navigator.geolocation.clearWatch(watchIdRef.current); } catch { /* noop */ }
      watchIdRef.current = null;
    }
    if (beforeUnloadRef.current) {
      window.removeEventListener('beforeunload', beforeUnloadRef.current);
      beforeUnloadRef.current = null;
    }
  };

  const stop = async () => {
    stopInternal();
    setStatus('stopped');
    try {
      await api.delete('/driver/vehicle-location');
      setErrorMsg(null);
    } catch (err) {
      // Even if the DELETE fails, local watch is already cleared (privacy).
      setErrorMsg(err?.response?.data?.message
        || 'หยุดติดตามในเครื่องเรียบร้อย แต่แจ้งเซิร์ฟเวอร์ไม่สำเร็จ');
    }
  };

  /* ── unmount: hard cleanup ──────────────────────────────────────────────── */
  useEffect(() => {
    return () => {
      stopInternal();
      // Best-effort backend pause — fire and forget; no await on unmount.
      try { api.delete('/driver/vehicle-location'); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── render ─────────────────────────────────────────────────────────────── */

  const meta = STATUS[status] || STATUS.idle;
  const showRetryHint = status === 'position_unavailable' || status === 'timeout' || status === 'network_error';

  return (
    <AppCard padding="md" className="mb-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="inline-flex items-center gap-2 text-base font-semibold text-ink">
          <MapPin className="w-5 h-5 text-brand" strokeWidth={2} />
          ส่งตำแหน่งรถ
        </div>
        <StatusBadge variant={meta.variant} size="md">
          {meta.label}
        </StatusBadge>
      </div>

      {/* Last-update + accuracy strip — visible whenever we have a value
          (kept after Stop so the driver can see what was last sent) */}
      {(lastSentAt || accuracy != null) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted mb-3 tabular-nums">
          {lastSentAt && (
            <span>
              อัปเดตล่าสุด {lastSentAt.toLocaleTimeString('th-TH', {
                hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Bangkok',
              })} น.
            </span>
          )}
          {accuracy != null && (
            <span>ความแม่นยำ ±{accuracy} เมตร</span>
          )}
        </div>
      )}

      {/* Error / hint banners */}
      {status === 'permission_denied' && (
        <AlertBanner variant="danger" title="ไม่ได้รับอนุญาตตำแหน่ง" className="mb-3">
          {errorMsg}
        </AlertBanner>
      )}
      {showRetryHint && errorMsg && (
        <AlertBanner variant="warn" title={meta.label} className="mb-3">
          {errorMsg}
        </AlertBanner>
      )}

      {/* Big mobile-friendly button */}
      {!isOn ? (
        <button
          type="button"
          onClick={start}
          className="w-full inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-700 active:bg-brand-700 text-white font-semibold text-base rounded-xl py-3 transition"
        >
          <Navigation className="w-5 h-5" strokeWidth={2.2} />
          เริ่มส่งตำแหน่ง
        </button>
      ) : (
        <button
          type="button"
          onClick={stop}
          className="w-full inline-flex items-center justify-center gap-2 bg-danger hover:bg-danger/90 active:bg-danger/90 text-white font-semibold text-base rounded-xl py-3 transition"
        >
          <OctagonAlert className="w-5 h-5" strokeWidth={2.2} />
          หยุดส่งตำแหน่ง
        </button>
      )}

      <p className="text-[11px] text-ink-muted mt-2 leading-snug">
        ระบบจะส่งตำแหน่งรถขณะที่คนขับเปิดใช้งานเท่านั้น และจะหยุดทันทีเมื่อกด "หยุดส่งตำแหน่ง"
        ปิดเบราว์เซอร์ หรือออกจากระบบ
      </p>
    </AppCard>
  );
}
