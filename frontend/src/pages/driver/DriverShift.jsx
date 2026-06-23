import { useCallback, useEffect, useState } from 'react';
import { Bus, CheckCircle2, Clock3, RefreshCw, ShieldAlert } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';
import { CommandHero } from '../../components/ui';

const REASONS = {
  VEHICLE_NOT_ELIGIBLE: 'รถยังไม่ผ่านเงื่อนไขความปลอดภัย',
  DRIVER_QUALIFICATION_NOT_VERIFIED: 'คุณสมบัติคนขับยังไม่รับรอง',
  DRIVER_LICENSE_EXPIRED: 'ใบอนุญาตขับรถหมดอายุ',
};

const VERIFICATION_LABEL = {
  ELIGIBLE: 'พร้อมเริ่มรอบ',
  EXPIRING: 'ใกล้หมดอายุ',
  EXPIRED: 'หมดอายุ',
  NOT_ELIGIBLE: 'ยังไม่ผ่านเงื่อนไข',
  NEEDS_FIX: 'ต้องแก้ไข',
};

function sessionLabel(session) {
  if (session === 'MORNING') return 'เช้า';
  if (session === 'EVENING') return 'เย็น';
  return 'อื่น ๆ';
}

function verificationVariant(status) {
  if (status === 'ELIGIBLE') return 'success';
  if (status === 'EXPIRING') return 'warn';
  if (['EXPIRED', 'NOT_ELIGIBLE', 'NEEDS_FIX'].includes(status)) return 'danger';
  return 'neutral';
}

function roleLabel(role) {
  return role === 'BACKUP' ? 'คนขับสำรอง' : 'คนขับหลัก';
}

function DriverVehicleCard({ vehicle, busy, onStart }) {
  const blockedReasons = (vehicle.blocking_reasons || []).map(reason => REASONS[reason] || reason);
  return (
    <AppCard padding="md" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold leading-tight text-ink">{vehicle.plate_no}</h2>
            <StatusBadge variant={vehicle.assignment_role === 'BACKUP' ? 'info' : 'brand'} size="sm">
              {roleLabel(vehicle.assignment_role)}
            </StatusBadge>
          </div>
          <p className="mt-1 text-sm text-ink-muted">{vehicle.vehicle_type || '-'}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusBadge variant={verificationVariant(vehicle.verification_status)}>
              {VERIFICATION_LABEL[vehicle.verification_status] || vehicle.verification_status || 'ไม่ทราบสถานะ'}
            </StatusBadge>
          </div>
        </div>
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
          <Bus className="h-7 w-7" strokeWidth={2.2} aria-hidden="true" />
        </span>
      </div>

      {vehicle.can_start ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => onStart(vehicle.vehicle_id)}
          className="mt-5 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-base font-bold text-white transition hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Clock3 className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
          เริ่มรอบด้วยรถคันนี้
        </button>
      ) : (
        <div className="mt-5 rounded-xl border border-danger/30 bg-danger-soft p-3 text-sm text-ink">
          <div className="flex gap-2">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" strokeWidth={2.2} aria-hidden="true" />
            <div>
              <p className="font-semibold">ยังเริ่มรอบด้วยรถคันนี้ไม่ได้</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-muted">
                {blockedReasons.length ? blockedReasons.map(reason => <li key={reason}>{reason}</li>) : <li>ระบบยังไม่พบเงื่อนไขที่อนุญาตให้เริ่มรอบ</li>}
              </ul>
            </div>
          </div>
        </div>
      )}
    </AppCard>
  );
}

function ActiveShiftCard({ active, busy, onEnd }) {
  return (
    <AppCard className="border-success/30 bg-success-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-success">กำลังปฏิบัติงาน</p>
          <h2 className="mt-1 text-3xl font-bold leading-tight text-green-950">{active.plate_no}</h2>
          <p className="mt-2 text-sm leading-6 text-green-900">
            รอบ {sessionLabel(active.session)} · เริ่ม {new Date(active.started_at).toLocaleString('th-TH')}
          </p>
          <StatusBadge variant="success" className="mt-3">
            {roleLabel(active.assignment_role)}
          </StatusBadge>
        </div>
        <CheckCircle2 className="h-12 w-12 shrink-0 text-success" strokeWidth={2.2} aria-hidden="true" />
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onEnd}
        className="mt-6 inline-flex min-h-[52px] w-full items-center justify-center rounded-xl bg-danger px-4 py-3 text-base font-bold text-white transition hover:bg-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        สิ้นสุดรอบ
      </button>
    </AppCard>
  );
}

export default function DriverShift() {
  const toast = useToast();
  const [vehicles, setVehicles] = useState([]);
  const [active, setActive] = useState(null);
  const [session, setSession] = useState('MORNING');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [vehicleRes, activeRes] = await Promise.all([
        api.get('/driver/authorized-vehicles'),
        api.get('/driver/active-shift'),
      ]);
      setVehicles(vehicleRes.data?.data || []);
      setActive(activeRes.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดสิทธิ์รถไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function start(vehicleId) {
    setBusy(true);
    try {
      await api.post('/driver/shifts/start', { vehicle_id: vehicleId, session });
      toast.success('เริ่มรอบและบันทึกคนขับจริงแล้ว');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'เริ่มรอบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    setBusy(true);
    try {
      await api.post(`/driver/shifts/${active.id}/end`, {});
      toast.success('ปิดรอบแล้ว');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ปิดรอบไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState />;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-3 sm:p-5">
      <CommandHero
        eyebrow="Driver daily workflow"
        title="เลือกรถและเริ่มรอบ"
        description="เลือกรถที่ได้รับอนุญาตก่อนเริ่มรับส่ง ระบบจะบันทึกว่ารอบจริงใช้รถคันใดและใครเป็นคนขับ"
        icon={Bus}
        meta={[
          `รอบ${sessionLabel(session)}`,
          active ? `กำลังขับ ${active.plate_no}` : `${vehicles.length} รถที่ได้รับสิทธิ์`,
          'ใช้ได้บนมือถือหน้างาน',
        ]}
        actions={(
          <button
            type="button"
            onClick={load}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-blue-950 transition hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <RefreshCw className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
            รีเฟรช
          </button>
        )}
      />

      {error && <ErrorState message={error} />}

      {active ? (
        <ActiveShiftCard active={active} busy={busy} onEnd={end} />
      ) : (
        <>
          <AppCard padding="md">
            <label className="block text-sm font-semibold text-ink">
              รอบการเดินรถ
              <select
                value={session}
                onChange={event => setSession(event.target.value)}
                className="mt-2 min-h-[44px] w-full rounded-lg border border-surface-border bg-white p-2 text-sm"
              >
                <option value="MORNING">เช้า</option>
                <option value="EVENING">เย็น</option>
                <option value="OTHER">อื่น ๆ</option>
              </select>
            </label>
          </AppCard>

          {vehicles.length === 0 ? (
            <EmptyState
              icon={Bus}
              title="ยังไม่มีรถที่ได้รับอนุญาต"
              description="ติดต่อโรงเรียนหรือเจ้าหน้าที่ขนส่งเพื่อเพิ่มรถและตรวจสอบใบอนุญาตคนขับ"
            />
          ) : (
            <div className="space-y-3">
              {vehicles.map(vehicle => (
                <DriverVehicleCard
                  key={vehicle.assignment_id}
                  vehicle={vehicle}
                  busy={busy}
                  onStart={start}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
