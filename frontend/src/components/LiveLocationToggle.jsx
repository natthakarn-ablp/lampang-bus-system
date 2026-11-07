import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Navigation, OctagonAlert, CloudUpload } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../hooks/useAuth';
import { AppCard, AlertBanner, StatusBadge } from './ui';
import { enqueuePoint, peekPoints, removeSent, countPoints } from '../utils/locationBuffer';
import { shouldDiscardBatch } from '../utils/locationSendErrors';
import {
  DEFAULT_TRACKING_WINDOWS,
  isWithinTrackingWindow,
  windowsLabel,
} from '../utils/gpsTrackingWindow';

/**
 * Phase 7.3 + 7.8 — Driver location sender.
 *
 * Hard guarantees (preserved from 7.3):
 *   • the toggle starts OFF on every page load (its on/off state is never stored)
 *   • does NOT call navigator.geolocation before the user taps Start
 *   • single watchPosition; cleared on Stop / unmount / beforeunload
 *   • Stop calls DELETE /driver/vehicle-location to flip backend status=PAUSED
 *   • capture throttle: a fix is taken when ≥15s have passed OR distance moved >30m
 *   • never includes vehicle_id in the body — backend resolves from JWT
 *   • never logs full lat/lng (privacy)
 *
 * 7.8 polish:
 *   • browser_offline state + window online/offline listeners
 *   • Permissions API probe on mount surfaces a pre-denied permission
 *   • clearer Thai copy per error code (incl. settings hint when denied)
 *
 * GPS route history (2026-11):
 *   • offline buffer — a fix that cannot be sent (no signal / send failed) is
 *     queued on the phone (IndexedDB, localStorage fallback; per user; ≤5,000
 *     points / 24 h, oldest dropped) and flushed oldest-first to
 *     POST /driver/vehicle-location/batch (≤200 per request) when the phone is
 *     back online, after the next successful send, and on page load.
 *   • tracking windows — fixes outside 05:00–09:00 / 15:00–19:00 (Bangkok;
 *     server-configurable) are neither sent nor queued.
 *   • limitation: this is a web page. When the browser is closed, or the
 *     screen is locked on phones that suspend background pages, no fixes are
 *     recorded at all — the buffer only covers time the page was open.
 */

const SEND_MIN_INTERVAL_MS = 15_000;
const SEND_MIN_DISTANCE_M  = 30;
const BATCH_SIZE           = 200;
const FLUSH_RETRY_MS       = 60_000;

const STATUS = {
  idle:                  { variant: 'neutral', label: 'ยังไม่ได้ส่งตำแหน่ง' },
  requesting_permission: { variant: 'info',    label: 'กำลังขออนุญาตตำแหน่ง' },
  sending:               { variant: 'success', label: 'กำลังส่งตำแหน่ง' },
  permission_denied:     { variant: 'danger',  label: 'ไม่ได้รับอนุญาตตำแหน่ง' },
  position_unavailable:  { variant: 'warn',    label: 'ไม่พบสัญญาณตำแหน่ง' },
  timeout:               { variant: 'warn',    label: 'ค้นหาตำแหน่งนานเกินไป' },
  network_error:         { variant: 'warn',    label: 'ส่งตำแหน่งไม่สำเร็จ' },
  browser_offline:       { variant: 'warn',    label: 'อุปกรณ์ออฟไลน์' },
  outside_window:        { variant: 'neutral', label: 'นอกช่วงเวลาติดตาม' },
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

// A send that may succeed later (no network, timeout, 5xx, 429) is worth
// queueing; a 4xx validation answer would only be rejected again.
function isRetryable(err) {
  const s = err?.response?.status;
  return !s || s >= 500 || s === 429 || s === 408;
}

export default function LiveLocationToggle() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [status, setStatus]         = useState('idle');
  const [lastSentAt, setLastSentAt] = useState(null);
  const [accuracy, setAccuracy]     = useState(null);
  const [errorMsg, setErrorMsg]     = useState(null);
  const [permPreDenied, setPermPreDenied] = useState(false);
  const [showRecoveryHint, setShowRecoveryHint] = useState(false);
  const [queued, setQueued]         = useState(0);
  const [flushing, setFlushing]     = useState(false);
  const [windows, setWindows]       = useState(DEFAULT_TRACKING_WINDOWS);

  const watchIdRef       = useRef(null);
  const lastCapturedRef  = useRef({ ts: 0, lat: null, lng: null });
  const isSendingRef     = useRef(false);
  const beforeUnloadRef  = useRef(null);
  const onlineHandlerRef = useRef(null);
  const offlineHandlerRef = useRef(null);
  const flushingRef      = useRef(false);
  const windowsRef       = useRef(DEFAULT_TRACKING_WINDOWS);
  const userIdRef        = useRef(userId);
  userIdRef.current = userId;

  const isOn = status === 'sending' || status === 'requesting_permission'
            || status === 'position_unavailable' || status === 'timeout'
            || status === 'network_error' || status === 'browser_offline'
            || status === 'outside_window';

  const adoptServerWindows = (data) => {
    const w = data?.tracking?.windows;
    if (Array.isArray(w) && w.length) {
      windowsRef.current = w;
      setWindows(w);
    }
  };

  /* ── offline buffer ─────────────────────────────────────────────────────── */

  const refreshQueued = useCallback(async () => {
    try { setQueued(await countPoints(userIdRef.current)); } catch { /* storage unavailable */ }
  }, []);

  const flushQueue = useCallback(async () => {
    if (flushingRef.current) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    if (userIdRef.current == null) return;
    flushingRef.current = true;
    setFlushing(true);
    try {
      // Bounded loop: at most 5,000 / 200 = 25 batches.
      for (let i = 0; i < 30; i++) {
        const batch = await peekPoints(userIdRef.current, BATCH_SIZE);
        if (!batch.length) break;
        const res = await api.post('/driver/vehicle-location/batch', { points: batch });
        adoptServerWindows(res?.data?.data);
        // accepted, duplicate AND rejected are all final answers — remove them.
        const left = await removeSent(userIdRef.current, batch.map((p) => p.recorded_at));
        setQueued(left);
        if (batch.length < BATCH_SIZE) break;
      }
    } catch (err) {
      // Keep the queue for network / rate limit AND recoverable 4xx (no vehicle,
      // no active assignment). Only a malformed batch would repeat forever.
      if (shouldDiscardBatch(err)) {
        try {
          const batch = await peekPoints(userIdRef.current, BATCH_SIZE);
          await removeSent(userIdRef.current, batch.map((p) => p.recorded_at));
        } catch { /* ignore */ }
      }
    } finally {
      flushingRef.current = false;
      setFlushing(false);
      refreshQueued();
    }
  }, [refreshQueued]);

  const queuePoint = async (point) => {
    try {
      const n = await enqueuePoint(userIdRef.current, point);
      setQueued(n);
    } catch { /* storage unavailable — point lost */ }
  };

  /* ── send helpers ───────────────────────────────────────────────────────── */

  const postPosition = async (body) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await queuePoint(body);
      if (isSendingRef.current) {
        setStatus('browser_offline');
        setErrorMsg('ไม่มีสัญญาณอินเทอร์เน็ต ระบบเก็บตำแหน่งไว้ในเครื่องและจะส่งให้อัตโนมัติเมื่อกลับมาออนไลน์');
      }
      return;
    }
    try {
      const res = await api.post('/driver/vehicle-location', body);
      const data = res?.data?.data;
      adoptServerWindows(data);
      if (data?.stored === false && data?.reason === 'OUTSIDE_TRACKING_WINDOW') {
        if (isSendingRef.current) setStatus('outside_window');
        setErrorMsg(null);
        return;
      }
      setLastSentAt(new Date());
      setAccuracy(body.accuracy_meters);
      if (isSendingRef.current) setStatus('sending');
      setErrorMsg(null);
      flushQueue();
    } catch (err) {
      const st = err?.response?.status;
      if (isRetryable(err) || st === 403 || st === 404) await queuePoint(body);
      if (isSendingRef.current) {
        setStatus('network_error');
        setErrorMsg(err?.response?.data?.message
          || 'อินเทอร์เน็ตอาจไม่เสถียร ระบบเก็บตำแหน่งไว้ในเครื่องและจะส่งให้อัตโนมัติเมื่อเชื่อมต่อได้');
      }
    }
  };

  const onPosition = (pos) => {
    if (!isSendingRef.current) return;
    const c = pos.coords;
    const now = Date.now();
    const fixTime = new Date(pos.timestamp || now);
    if (!isWithinTrackingWindow(fixTime, windowsRef.current)) {
      // Outside the school-run windows: neither sent nor queued.
      setStatus('outside_window');
      setErrorMsg(null);
      return;
    }
    const last = lastCapturedRef.current;
    const moved = (last.lat == null || last.lng == null)
      ? Infinity
      : getDistanceMeters(last.lat, last.lng, c.latitude, c.longitude);
    const aged = now - last.ts;
    if (last.ts !== 0 && aged < SEND_MIN_INTERVAL_MS && moved < SEND_MIN_DISTANCE_M) {
      return;
    }
    // Gate on the last CAPTURED fix (sent or queued), so an offline phone
    // still records one point per 15 s / 30 m rather than one per callback.
    lastCapturedRef.current = { ts: now, lat: c.latitude, lng: c.longitude };
    postPosition({
      latitude:        c.latitude,
      longitude:       c.longitude,
      accuracy_meters: c.accuracy != null ? Math.round(c.accuracy) : null,
      speed_mps:       Number.isFinite(c.speed)   ? c.speed   : null,
      heading_deg:     Number.isFinite(c.heading) ? c.heading : null,
      recorded_at:     fixTime.toISOString(),
    });
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
    const offline = navigator.onLine === false;
    const inWindow = isWithinTrackingWindow(new Date(), windowsRef.current);
    setStatus(!inWindow ? 'outside_window' : offline ? 'browser_offline' : 'requesting_permission');
    setErrorMsg(offline && inWindow
      ? 'ไม่มีสัญญาณอินเทอร์เน็ต ระบบเก็บตำแหน่งไว้ในเครื่องและจะส่งให้อัตโนมัติเมื่อกลับมาออนไลน์'
      : null);
    setShowRecoveryHint(false);
    lastCapturedRef.current = { ts: 0, lat: null, lng: null };

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

    offlineHandlerRef.current = () => {
      if (!isSendingRef.current) return;
      setStatus('browser_offline');
      setErrorMsg('ไม่มีสัญญาณอินเทอร์เน็ต ระบบเก็บตำแหน่งไว้ในเครื่องและจะส่งให้อัตโนมัติเมื่อกลับมาออนไลน์');
      setShowRecoveryHint(false);
    };
    onlineHandlerRef.current = () => {
      if (!isSendingRef.current) return;
      setShowRecoveryHint(true);
      setStatus(isWithinTrackingWindow(new Date(), windowsRef.current) ? 'sending' : 'outside_window');
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
    // Points already captured were recorded with the driver's consent; still
    // deliver them, then tell the server the driver stopped.
    flushQueue();
    try {
      await api.delete('/driver/vehicle-location');
      setErrorMsg(null);
    } catch (err) {
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
          result.onchange = () => {
            if (cancelled) return;
            setPermPreDenied(result.state === 'denied');
          };
        })
        .catch(() => { /* feature not supported — ignore */ });
    }
    return () => { cancelled = true; };
  }, []);

  /* ── buffer: count + flush on load, on reconnect, and periodically ──────── */
  useEffect(() => {
    if (userId == null) return undefined;
    refreshQueued().then(() => flushQueue());
    const onOnline = () => flushQueue();
    window.addEventListener('online', onOnline);
    const id = setInterval(() => { flushQueue(); }, FLUSH_RETRY_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(id);
    };
  }, [userId, refreshQueued, flushQueue]);

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
  const label = windowsLabel(windows);

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
                <span className="ml-1 text-warn-ink font-medium">· ความแม่นยำต่ำ</span>
              )}
            </span>
          )}
        </div>
      )}

      {queued > 0 && (
        <p
          className="flex items-center gap-1.5 text-xs font-medium text-warn-ink mb-3 tabular-nums"
          role="status"
          data-testid="gps-queue-status"
        >
          <CloudUpload className="w-4 h-4 shrink-0" strokeWidth={2} />
          {flushing
            ? `กำลังส่งตำแหน่งย้อนหลัง ${queued.toLocaleString('th-TH')} จุด`
            : `รอส่งตำแหน่ง ${queued.toLocaleString('th-TH')} จุด (ไม่มีสัญญาณ)`}
        </p>
      )}

      {status === 'outside_window' && (
        <AlertBanner variant="info" title={`นอกช่วงเวลาติดตาม (${label})`} className="mb-3">
          ระบบบันทึกตำแหน่งรถเฉพาะช่วงรับส่งนักเรียน เปิดค้างไว้ได้ ระบบจะเริ่มส่งเองเมื่อถึงช่วงเวลา
        </AlertBanner>
      )}

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
          ระบบจะส่งตำแหน่งที่เก็บไว้ในเครื่องให้อัตโนมัติ
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
          className="w-full inline-flex items-center justify-center gap-2 bg-danger-ink hover:bg-danger-ink/90 active:bg-danger-ink/90 text-white font-semibold text-base rounded-xl py-3 transition"
        >
          <OctagonAlert className="w-5 h-5" strokeWidth={2.2} />
          หยุดส่งตำแหน่ง
        </button>
      )}

      <p className="text-[11px] text-ink-muted mt-2 leading-snug">
        ระบบบันทึกตำแหน่งรถเฉพาะช่วง {label} น. ขณะที่คนขับเปิดใช้งาน และหยุดทันทีเมื่อกด "หยุดส่งตำแหน่ง"
        ปิดเบราว์เซอร์ หรือออกจากระบบ หากไม่มีสัญญาณ ระบบจะเก็บตำแหน่งไว้ในเครื่องแล้วส่งให้เมื่อกลับมาออนไลน์
        (ต้องเปิดหน้านี้ค้างไว้ โทรศัพท์บางรุ่นหยุดบันทึกเมื่อล็อกหน้าจอ)
      </p>
    </AppCard>
  );
}
