import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

// Geolocation timeout per Phase 10.3E-HF2 design decision: try for 8s,
// then give up and let the driver submit anyway. Emergency reporting must
// never be blocked by location services — the LINE card will simply show
// a "ไม่สามารถระบุตำแหน่ง GPS ได้" warning instead of coordinates.
const GPS_TIMEOUT_MS = 8000;

export default function EmergencyPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [detail,  setDetail]  = useState('');
  const [note,    setNote]    = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error,   setError]   = useState('');

  // GPS state machine: 'requesting' → 'granted' | 'denied' | 'timeout' | 'unsupported'
  const [gpsStatus, setGpsStatus] = useState('requesting');
  const [position,  setPosition]  = useState(null); // { latitude, longitude, accuracy }
  const timeoutRef = useRef(null);

  const requestGps = useCallback(() => {
    if (!('geolocation' in navigator)) {
      console.log('[GPS_EMERGENCY] unsupported');
      setGpsStatus('unsupported');
      return () => {};
    }
    console.log('[GPS_EMERGENCY] requesting');
    setGpsStatus('requesting');
    setPosition(null);
    let cancelled = false;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (cancelled) return;
      // setTimeout fires only if the browser hasn't already resolved/rejected;
      // protect against late callbacks by checking current status.
      setGpsStatus((s) => {
        if (s === 'requesting') {
          console.log('[GPS_EMERGENCY] timeout');
          return 'timeout';
        }
        return s;
      });
    }, GPS_TIMEOUT_MS);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        clearTimeout(timeoutRef.current);
        const accuracy = Math.round(pos.coords.accuracy);
        console.log('[GPS_EMERGENCY] granted', { accuracy });
        setPosition({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setGpsStatus('granted');
      },
      (err) => {
        if (cancelled) return;
        clearTimeout(timeoutRef.current);
        if (err.code === err.PERMISSION_DENIED) {
          console.log('[GPS_EMERGENCY] denied');
          setGpsStatus('denied');
        } else {
          // TIMEOUT (3) and POSITION_UNAVAILABLE (2) both map to 'timeout' UX.
          console.log('[GPS_EMERGENCY] timeout', { errCode: err.code });
          setGpsStatus('timeout');
        }
      },
      { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 30_000 }
    );

    return () => {
      cancelled = true;
      clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const cleanup = requestGps();
    return cleanup;
  }, [requestGps]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const payload = { detail, note, gps_status: gpsStatus };
      if (position) {
        payload.latitude = position.latitude;
        payload.longitude = position.longitude;
        payload.accuracy = Math.round(position.accuracy);
      }
      await api.post('/driver/emergency', payload);
      toast.success('แจ้งเหตุฉุกเฉินสำเร็จ');
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.message || 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="p-3 sm:p-6 max-w-lg mx-auto flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-6xl mb-5">✅</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">แจ้งเหตุฉุกเฉินแล้ว</h2>
        <p className="text-gray-500 text-sm mb-8">ทีมงานจะดำเนินการโดยเร็ว</p>
        <button
          onClick={() => navigate('/driver', { replace: true })}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-8 py-2.5 rounded-lg transition"
        >
          กลับหน้าหลัก
        </button>
      </div>
    );
  }

  const gpsCard = (() => {
    switch (gpsStatus) {
      case 'requesting':
        return {
          tone: 'border-info bg-info-soft text-info',
          icon: '📡',
          title: 'กำลังขอตำแหน่ง GPS…',
          body: 'กรุณาอนุญาตการเข้าถึงตำแหน่งเมื่อเบราว์เซอร์ถาม',
          pulse: true,
          retry: false,
        };
      case 'granted':
        return {
          tone: 'border-success bg-success-soft text-success',
          icon: '📍',
          title: 'ระบุตำแหน่งได้แล้ว',
          body: `ความแม่นยำ ±${Math.round(position?.accuracy ?? 0)} เมตร`,
          pulse: false,
          retry: false,
        };
      case 'denied':
        return {
          tone: 'border-warn bg-warn-soft text-warn',
          icon: '⚠️',
          title: 'ปฏิเสธการเข้าถึงตำแหน่ง',
          body: 'เปิดสิทธิ์ตำแหน่งใน Safari → Settings → Privacy แล้วกดลองอีกครั้ง',
          pulse: false,
          retry: true,
        };
      case 'timeout':
        return {
          tone: 'border-warn bg-warn-soft text-warn',
          icon: '⚠️',
          title: 'ระบุตำแหน่งไม่สำเร็จ',
          body: 'ลองออกไปนอกอาคารแล้วกดลองอีกครั้ง หรือส่งโดยไม่มี GPS ก็ได้',
          pulse: false,
          retry: true,
        };
      case 'unsupported':
      default:
        return {
          tone: 'border-warn bg-warn-soft text-warn',
          icon: '⚠️',
          title: 'อุปกรณ์ไม่รองรับ GPS',
          body: 'จะส่งโดยไม่มีตำแหน่ง',
          pulse: false,
          retry: false,
        };
    }
  })();

  return (
    <div className="p-3 sm:p-6 max-w-lg mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-red-700">🚨 แจ้งเหตุฉุกเฉิน</h1>
        <p className="text-sm text-gray-500 mt-1">กรอกรายละเอียดเหตุการณ์ที่เกิดขึ้น</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            รายละเอียด <span className="text-red-500">*</span>
          </label>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            required
            rows={4}
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            placeholder="อธิบายเหตุการณ์ที่เกิดขึ้น เช่น รถเสีย, อุบัติเหตุ, นักเรียนเจ็บป่วย"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            placeholder="ข้อมูลเพิ่มเติม (ถ้ามี)"
          />
        </div>

        <div
          data-testid="gps-status-card"
          className={`rounded-xl border px-4 py-3.5 flex items-start gap-3 ${gpsCard.tone} ${gpsCard.pulse ? 'animate-pulse' : ''}`}
        >
          <span className="text-2xl leading-none mt-0.5" aria-hidden>{gpsCard.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm leading-tight">{gpsCard.title}</div>
            <div className="text-xs mt-1 opacity-90 leading-snug">{gpsCard.body}</div>
            {gpsCard.retry && (
              <button
                type="button"
                onClick={requestGps}
                className="mt-1 inline-flex min-h-[44px] items-center text-xs font-semibold underline underline-offset-2 hover:opacity-80"
              >
                ลองขอตำแหน่งอีกครั้ง
              </button>
            )}
          </div>
        </div>

        {error && (
          <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition"
          >
            {loading ? 'กำลังส่ง…' : 'แจ้งเหตุฉุกเฉิน'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-lg transition"
          >
            ยกเลิก
          </button>
        </div>
      </form>
    </div>
  );
}
