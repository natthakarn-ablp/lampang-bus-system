import { useEffect, useRef, useState } from 'react';
import { MapPin, Navigation, OctagonAlert } from 'lucide-react';
import api from '../api/axios';
import { AppCard, AlertBanner, StatusBadge } from './ui';

/**
 * Phase 7.3 + 7.8 — Driver location sender.
 *
 * Hard guarantees (preserved from 7.3):
 *   • starts OFF on every page load (no localStorage / sessionStorage)
 *   • does NOT call navigator.geolocation before the user taps Start
 *   • single watchPosition; cleared on Stop / unmount / beforeunload
 *   • Stop calls DELETE /driver/vehicle-location to flip backend status=PAUSED
 *   • POST throttle: send when ≥15s have passed OR distance moved >30m
 *   • never includes vehicle_id in the body — backend resolves from JWT
 *   • never logs full lat/lng (privacy)
 *
 * 7.8 polish:
 *   • new browser_offline state + window online/offline listeners
 *   • Permissions API probe on mount surfaces a pre-denied permission
 *     so the driver gets explicit copy without having to tap Start first
 *   • clearer Thai copy per error code (incl. settings hint when denied)
 *   • DELETE-failure message reframed: "หยุดในเครื่องแล้ว แต่แจ้ง
 *     เซิร์ฟเวอร์ไม่สำเร็จ — ข้อมูลจะกลายเป็นออฟไลน์เมื่อเกินเวลา"
 */

const SEND_MIN_INTERVAL_MS = 15_000;
const SEND_MIN_DISTANCE_M  = 30;

const STATUS = {
  idle:                  { variant: 'neutral', label: 'ยังไม่ได้ส่งตำแหน่ง' },
  requesting_permission: { variant: 'info',    label: 'กำลังขออนุญาตตำแหน่ง' },
  sending:               { variant: 'success', label: 'กำลังส่งตำแหน่ง' },
  permission_denied:     { variant: 'danger',  label: 'ไม่ได้รับอนุญาตตำแหน่ง' },
  position_unavailable:  { variant: 'warn',    label: 'ไม่พบสัญญาณตำแหน่ง' },
  timeout:               { variant: 'warn',    label: 'ค้นหาตำแหน่งนานเกินไป' },
  network_error:         { variant: 'warn',    label: 'ส่งตำแหน่งไม่สำเร็จ' },
  browser_offline:       { variant: 'warn',    label: 'อุปกรณ์ออฟไลน์' },
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
  const [lastSentAt, setLastSentAt] = useState(null);
  const [accuracy, setAccuracy]     = useState(null);
  const [errorMsg, setErrorMsg]     = useState(null);
  // Whether the OS-level permission was probed and is currently 'denied'.
  // Drives a pre-flight banner so the driver isn't surprised by a wasted
  // Start tap on a device that previously refused permission.
  const [permPreDenied, setPermPreDenied] = useState(false);
  // Soft hint shown briefly after the browser regains online connectivity
  // — purely informational, not a status-state.
  const [showRecoveryHint, setShowRecoveryHint] = useState(false);

  const watchIdRef       = useRef(null);
  const lastSentRef      = useRef({ ts: 0, lat: null, lng: null });
  const isSendingRef     = useRef(false);
  const beforeUnloadRef  = useRef(null);
  const onlineHandlerRef = useRef(null);
  const offlineHandlerRef = useRef(null);

  const isOn = status === 'sending' || status === 'requesting_permission'
            || status === 'position_unavailable' || status === 'timeout'
            || status === 'network_error' || status === 'browser_offline';

  /* ── send helpers ───────────────────────────────────────────────────────── */

  const postPosition = async (coords, recordedAt) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      // Skip the network call when we know we're offline; the next
      // position callback will retry once we're back online.
      if (isSendingRef.current) {
        setStatus('browser_offline');
        setErrorMsg('ไม่มีสัญญาณอินเทอร์เน็ตในขณะนี้ ระบบจะลองส่งใหม่เมื่อกลับมาออนไลน์');
      }
      return;
    }
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
      if (isSendingRef.current) setStatus('sending');
      setErrorMsg(null);
    } catch (err) {
      if (isSendingRef.current) {
        setStatus('network_error');
        setErrorMsg(err?.response?.data?.message
          || 'อินเทอร์เน็ตอาจไม่เสถียร ระบบยังคงรอสัญญาณ GPS และจะลองส่งใหม่เมื่อเชื่อมต่อได้');
      }
    }
  };

  const onPosition = (pos) => {
    if (!isSendingRef.current) return;
    const c = pos.coords;
    const now = Date.now();
    const last = lastSentRef.current;
    const moved = (last.lat == null || last.lng == null)
      ? Infinity
      : getDistanceMeters(last.lat, last.lng, c.latitude, c.longitude);
    const aged = now - last.ts;
    if (last.ts !== 0 && aged < SEND_MIN_INTERVAL_MS && moved < SEND_MIN_DISTANCE_M) {
      return;
    }
    const recordedAt = new Date(pos.timestamp || now).toISOString();
    postPosition(c, recordedAt);
  };

  const onPositionError = (err) => {
    if (!isSendingRef.current) return;
    if (err.code === err.PERMISSION_DENIED) {
      stopInternal();
      setStatus('permission_denied');
      setPermPreDenied(true);
      setErrorMsg('กรุณาอนุญาตการเข้าถึงตำแหน่งในเบราว์เซอร์ แล้วกดเริ่มส่งตำแหน่งอีกครั้ง');
      return;
    }
    if (err.code === err.POSITION_UNAVAILABLE) {
      setStatus('position_unavailable');
      setErrorMsg('กรุณาอยู่ในพื้นที่เปิดโล่ง หรือเปิด GPS/Location Services ของอุปกรณ์ ระบบจะลองใหม่โดยอัตโนมัติ');
      return;
    }
    if (err.code === err.TIMEOUT) {
      setStatus('timeout');
      setErrorMsg('สัญญาณอาจอ่อนหรืออุปกรณ์ประหยัดพลังงานเกินไป ระบบจะลองใหม่ในรอบถัดไป');
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
    setStatus(navigator.onLine === false ? 'browser_offline' : 'requesting_permission');
    setErrorMsg(navigator.onLine === false
      ? 'ไม่มีสัญญาณอินเทอร์เน็ตในขณะนี้ ระบบจะลองส่งใหม่เมื่อกลับมาออนไลน์'
      : null);
    setShowRecoveryHint(false);
    lastSentRef.current = { ts: 0, lat: null, lng: null };

    watchIdRef.current = navigator.geolocation.watchPosition(
      onPosition,
      onPositionError,
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );

    // beforeunload — privacy-first cleanup
    beforeUnloadRef.current = () => {
      if (watchIdRef.current != null) {
        try { navigator.geolocation.clearWatch(watchIdRef.current); } catch { /* noop */ }
        watchIdRef.current = null;
      }
      try { api.delete('/driver/vehicle-location'); } catch { /* noop */ }
    };
    window.addEventListener('beforeunload', beforeUnloadRef.current);

    // Online/offline listeners — only attached while toggle is ON
    offlineHandlerRef.current = () => {
      if (!isSendingRef.current) return;
      setStatus('browser_offline');
      setErrorMsg('ไม่มีสัญญาณอินเทอร์เน็ตในขณะนี้ ระบบจะลองส่งใหม่เมื่อกลับมาออนไลน์');
      setShowRecoveryHint(false);
    };
    onlineHandlerRef.current = () => {
      if (!isSendingRef.current) return;
      setShowRecoveryHint(true);
      // Don't force-set 'sending' — the next watchPosition tick will move
      // us forward naturally. But clear the offline error so the UI
      // doesn't keep claiming we're offline.
      setStatus('sending');
      setErrorMsg(null);
      setTimeout(() => setShowRecoveryHint(false), 4_000);
    };
    window.addEventListener('offline', offlineHandlerRef.current);
    window.addEventListener('online',  onlineHandlerRef.current);
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
    if (onlineHandlerRef.current) {
      window.removeEventListener('online', onlineHandlerRef.current);
      onlineHandlerRef.current = null;
    }
    if (offlineHandlerRef.current) {
      window.removeEventListener('offline', offlineHandlerRef.current);
      offlineHandlerRef.current = null;
    }
  };

  const stop = async () => {
    stopInternal();
    setStatus('stopped');
    setShowRecoveryHint(false);
    try {
      await api.delete('/driver/vehicle-location');
      setErrorMsg(null);
    } catch (err) {
      // Local watch is already cleared above (privacy first).
      setErrorMsg(err?.response?.data?.message
        || 'หยุดการส่งจากอุปกรณ์แล้ว แต่แจ้งเซิร์ฟเวอร์ไม่สำเร็จ ข้อมูลจะเปลี่ยนเป็นออฟไลน์เมื่อเกินเวลาที่กำหนด');
    }
  };

  /* ── mount: probe browser permission state (read-only — does NOT prompt) ─── */
  useEffect(() => {
    let cancelled = false;
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' })
        .then(result => {
          if (cancelled) return;
          if (result.state === 'denied') setPermPreDenied(true);
          // Listen for runtime changes (driver toggles permission in
          // browser settings while the page is open).
          result.onchange = () => {
            if (cancelled) return;
            setPermPreDenied(result.state === 'denied');
          };
        })
        .catch(() => { /* feature not supported — ignore */ });
    }
    return () => { cancelled = true; };
  }, []);

  /* ── unmount: hard cleanup ──────────────────────────────────────────────── */
  useEffect(() => {
    return () => {
      stopInternal();
      try { api.delete('/driver/vehicle-location'); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── render ─────────────────────────────────────────────────────────────── */

  const meta = STATUS[status] || STATUS.idle;
  const showRetryHint =
       status === 'position_unavailable'
    || status === 'timeout'
    || status === 'network_error'
    || status === 'browser_offline';

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
            <span>
              ความแม่นยำ ±{accuracy} เมตร
              {accuracy > 200 && (
                <span className="ml-1 text-warn font-medium">· ความแม่นยำต่ำ</span>
              )}
            </span>
          )}
        </div>
      )}

      {/* Pre-flight banner: permission was previously denied at the OS / browser level */}
      {!isOn && permPreDenied && status !== 'permission_denied' && (
        <AlertBanner variant="danger" title="ไม่ได้รับอนุญาตตำแหน่ง" className="mb-3">
          <p>กรุณาอนุญาตการเข้าถึงตำแหน่งในเบราว์เซอร์ แล้วกดเริ่มส่งตำแหน่งอีกครั้ง</p>
          <p className="mt-1 text-xs text-ink-muted">
            หากปิดสิทธิ์ถาวร ให้กดไอคอนกุญแจ/ตั้งค่าเว็บไซต์บนแถบที่อยู่ แล้วอนุญาตตำแหน่ง
          </p>
        </AlertBanner>
      )}

      {status === 'permission_denied' && (
        <AlertBanner variant="danger" title="ไม่ได้รับอนุญาตตำแหน่ง" className="mb-3">
          <p>{errorMsg}</p>
          <p className="mt-1 text-xs text-ink-muted">
            หากปิดสิทธิ์ถาวร ให้กดไอคอนกุญแจ/ตั้งค่าเว็บไซต์บนแถบที่อยู่ แล้วอนุญาตตำแหน่ง
          </p>
        </AlertBanner>
      )}

      {showRetryHint && errorMsg && (
        <AlertBanner variant="warn" title={meta.label} className="mb-3">
          {errorMsg}
        </AlertBanner>
      )}

      {showRecoveryHint && (
        <AlertBanner variant="info" title="กลับมาออนไลน์แล้ว" className="mb-3">
          ระบบจะลองส่งตำแหน่งในรอบถัดไป
        </AlertBanner>
      )}

      {status === 'stopped' && errorMsg && (
        <AlertBanner variant="warn" title="แจ้งเซิร์ฟเวอร์ไม่สำเร็จ" className="mb-3">
          {errorMsg}
        </AlertBanner>
      )}

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
