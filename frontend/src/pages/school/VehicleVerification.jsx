import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle,
  Bus,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Printer,
  RefreshCw,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';
import { AlertBanner, CommandHero, StatusStepRail } from '../../components/ui';

const STATUS = {
  PENDING_SCHOOL_REVIEW: ['รอตรวจสอบ', 'warn'],
  DRAFT: ['ฉบับร่าง', 'neutral'],
  READY_TO_PRINT: ['พร้อมพิมพ์', 'info'],
  SUBMITTED: ['ยื่นแล้ว', 'info'],
  INSPECTION_PENDING: ['กำลังตรวจ', 'warn'],
  NEEDS_FIX: ['ต้องแก้ไข', 'warn'],
  PASSED: ['ผ่าน', 'success'],
  FAILED: ['ไม่ผ่าน', 'danger'],
  CANCELLED: ['ยกเลิก', 'neutral'],
  REJECTED: ['ปฏิเสธ', 'danger'],
  EXPIRED: ['หมดอายุ', 'danger'],
  SUPERSEDED: ['มีฉบับใหม่', 'neutral'],
};

const CLOSED_STATUSES = new Set(['CANCELLED', 'FAILED', 'PASSED', 'EXPIRED', 'SUPERSEDED', 'REJECTED']);

const CANCELLABLE_STATUSES = new Set([
  'DRAFT',
  'READY_TO_PRINT',
  'SUBMITTED',
  'INSPECTION_PENDING',
  'NEEDS_FIX',
]);

function Badge({ status }) {
  const [label, variant] = STATUS[status] || [status || '-', 'neutral'];
  return <StatusBadge variant={variant}>{label}</StatusBadge>;
}

function statusCount(applications, statusList) {
  return applications.filter(app => statusList.includes(app.status)).length;
}

function progressFor(selected) {
  if (!selected) return 'vehicle';
  if (selected.status === 'PASSED') return 'certified';
  if (['SUBMITTED', 'INSPECTION_PENDING', 'NEEDS_FIX', 'FAILED'].includes(selected.status)) return 'transport';
  return 'packet';
}

function stepStatus(selected, key) {
  const current = progressFor(selected);
  if (key === current) {
    if (selected?.status === 'NEEDS_FIX') return 'warning';
    if (selected?.status === 'FAILED') return 'danger';
    return 'current';
  }
  const order = ['vehicle', 'packet', 'transport', 'certified'];
  if (order.indexOf(key) < order.indexOf(current)) return 'complete';
  if (selected?.status === 'PASSED' && key === 'certified') return 'complete';
  return 'upcoming';
}

function VerificationProgress({ selected }) {
  const steps = [
    {
      key: 'vehicle',
      label: 'เลือกรถ',
      description: 'เลือกรถที่โรงเรียนใช้งาน',
      status: stepStatus(selected, 'vehicle'),
    },
    {
      key: 'packet',
      label: 'ออกใบส่งตรวจ',
      description: 'รวมจำนวนเด็กตามโรงเรียน',
      status: stepStatus(selected, 'packet'),
    },
    {
      key: 'transport',
      label: 'ขนส่งตรวจ',
      description: 'เจ้าหน้าที่ลงผลในระบบ',
      status: stepStatus(selected, 'transport'),
    },
    {
      key: 'certified',
      label: 'รับรองผล',
      description: 'โรงเรียนติดตามสถานะได้',
      status: stepStatus(selected, 'certified'),
    },
  ];

  return <StatusStepRail steps={steps} ariaLabel="ขั้นตอนใบส่งตรวจและรับรองรถ" />;
}

function VehiclePrivacyNotice({ className = '' }) {
  return (
    <AlertBanner
      variant="info"
      icon={ShieldCheck}
      title="ขนส่งเห็นข้อมูลเท่าที่จำเป็นต่อการตรวจรถ"
      className={className}
    >
      เอกสารนี้แสดงข้อมูลรถ คนขับ จำนวนผู้โดยสารแยกโรงเรียน และพื้นที่รับส่ง ไม่แสดงรายชื่อนักเรียนหรือข้อมูลผู้ปกครอง
    </AlertBanner>
  );
}

function VehicleRequestCard({ vehicle, activeApplication, disabled, busy, onCreate, onOpen }) {
  const hasActive = Boolean(activeApplication);
  return (
    <div className="rounded-xl border border-surface-border bg-surface-raised p-4 transition hover:border-brand-200 hover:bg-brand-50/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold leading-tight text-ink">{vehicle.plate_no}</h3>
            {hasActive && <Badge status={activeApplication.status} />}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {vehicle.vehicle_type || 'ไม่ระบุประเภท'} · นักเรียนโรงเรียนนี้ {vehicle.student_count || 0} คน
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink-muted">
            <span className="rounded-full bg-surface px-2.5 py-1">ความจุรับรอง {vehicle.certified_capacity || '-'} คน</span>
            <span className="rounded-full bg-surface px-2.5 py-1">เอกสารออนไลน์</span>
          </div>
        </div>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Bus className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
        </span>
      </div>

      <div className="mt-4">
        {hasActive ? (
          <button
            type="button"
            onClick={() => onOpen(activeApplication.id)}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40"
          >
            เปิดคำขอ
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || disabled}
            onClick={() => onCreate(vehicle.id)}
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            สร้างใบส่งตรวจ
          </button>
        )}
      </div>
    </div>
  );
}

function VerificationHistoryRow({ application, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(application.id)}
      className="w-full rounded-xl border border-transparent px-3 py-3 text-left transition hover:border-surface-border hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink">{application.plate_no}</span>
          <span className="mt-0.5 block truncate text-xs text-ink-muted">{application.request_no}</span>
        </span>
        <Badge status={application.status} />
      </div>
    </button>
  );
}

function VerificationPacket({ selected, qr, busy, isGradeTeacher, onBack, onMarkReady, onReview, onCancel }) {
  return (
    <AppCard className="motion-safe:animate-fade-in-up motion-reduce:animate-none print:animate-none print:shadow-none print:border-0">
      <div className="flex flex-wrap justify-between gap-3 border-b border-surface-border pb-4 print:border-slate-400">
        <div className="min-w-0">
          <p className="text-xs text-ink-muted">องค์การบริหารส่วนจังหวัดลำปาง</p>
          <h2 className="mt-1 text-2xl font-bold leading-tight text-ink text-balance">
            ใบส่งรถรับส่งนักเรียนเข้ารับการตรวจ
          </h2>
          <p className="mt-1 text-sm text-ink-muted">เลขที่ {selected.request_no}</p>
        </div>
        <Badge status={selected.status} />
      </div>

      <div className="mt-5 grid gap-6 md:grid-cols-[1fr_180px]">
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-surface p-3">
              <p className="text-xs text-ink-muted">ทะเบียนรถ</p>
              <p className="mt-1 text-xl font-bold text-ink">{selected.plate_no}</p>
            </div>
            <div className="rounded-xl bg-surface p-3">
              <p className="text-xs text-ink-muted">ประเภทรถ</p>
              <p className="mt-1 font-semibold text-ink">{selected.vehicle_type || '-'}</p>
            </div>
            <div className="rounded-xl bg-surface p-3">
              <p className="text-xs text-ink-muted">ความจุรับรอง</p>
              <p className="mt-1 font-semibold text-ink">{selected.certified_capacity || '-'} คน</p>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-ink-muted" strokeWidth={2.2} aria-hidden="true" />
              <h3 className="font-semibold text-ink">จำนวนผู้โดยสารแยกโรงเรียน</h3>
            </div>
            <p className="mt-1 text-sm text-ink-muted">แสดงเฉพาะจำนวน ไม่มีรายชื่อนักเรียน</p>
            <div className="mt-3 overflow-x-auto rounded-xl border border-surface-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface text-left text-ink-muted">
                    <th className="p-3 font-semibold">โรงเรียน</th>
                    <th className="p-3 font-semibold">เช้า</th>
                    <th className="p-3 font-semibold">เย็น</th>
                    <th className="p-3 font-semibold">สูงสุด</th>
                  </tr>
                </thead>
                <tbody>
                  {(selected.schools || []).map(school => (
                    <tr key={school.school_id} className="border-t border-surface-border">
                      <td className="p-3 text-ink">{school.school_name}</td>
                      <td className="p-3 text-ink-muted">{school.morning_rider_count}</td>
                      <td className="p-3 text-ink-muted">{school.evening_rider_count}</td>
                      <td className="p-3 font-semibold text-ink">{school.peak_rider_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm font-semibold text-ink">
              จำนวนสูงสุดรวมต่อรอบ: {selected.peak_rider_count} คน
            </p>
          </div>

          <div className="rounded-xl border border-surface-border bg-surface p-4">
            <h3 className="font-semibold text-ink">พื้นที่รับส่งโดยสรุป</h3>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              {(selected.routes || []).map(route => route.pickup_area).filter(Boolean).join(', ') || 'ยังไม่ระบุ'}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-surface-border bg-surface p-4 text-center print:border-slate-400">
          {qr && <img src={qr} alt="QR สำหรับเปิดคำขอ" className="mx-auto h-40 w-40" />}
          <p className="mt-2 text-xs leading-5 text-ink-muted">เจ้าหน้าที่ขนส่งสแกนเพื่อเปิดคำขอนี้</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 border-t border-surface-border pt-4 print:hidden">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-surface-border bg-surface-raised px-4 py-2 text-sm font-semibold text-ink transition hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40"
        >
          กลับไปเลือกรถ
        </button>
        {selected.status === 'PENDING_SCHOOL_REVIEW' && !isGradeTeacher && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onReview(true)}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
              ตรวจสอบถูกต้อง
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onReview(false)}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-2 text-sm font-semibold text-danger-ink transition hover:bg-danger/10 disabled:opacity-50"
            >
              ปฏิเสธคำขอ
            </button>
          </>
        )}
        {selected.status === 'DRAFT' && !isGradeTeacher && (
          <button
            type="button"
            disabled={busy}
            onClick={onMarkReady}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            <FileCheck2 className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
            ยืนยันข้อมูลพร้อมพิมพ์
          </button>
        )}
        {selected.status !== 'DRAFT' && (
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
          >
            <Printer className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
            พิมพ์ใบส่งตรวจ
          </button>
        )}
        {CANCELLABLE_STATUSES.has(selected.status) && !isGradeTeacher && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-2 text-sm font-semibold text-danger-ink transition hover:bg-danger/10 disabled:opacity-50"
          >
            <XCircle className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
            ยกเลิกคำขอ
          </button>
        )}
      </div>

      <VehiclePrivacyNotice className="mt-4 print:border-slate-400" />
    </AppCard>
  );
}

export default function VehicleVerification() {
  const { user } = useAuth();
  const toast = useToast();
  const [vehicles, setVehicles] = useState([]);
  const [applications, setApplications] = useState([]);
  const [selected, setSelected] = useState(null);
  const [qr, setQr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isGradeTeacher = Boolean(user?.grade_scope || user?.gradeScope);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [vehicleRes, appRes] = await Promise.all([
        api.get('/school/vehicles'),
        api.get('/verification/school/applications'),
      ]);
      setVehicles(vehicleRes.data?.data || []);
      setApplications(appRes.data?.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลส่งตรวจรถไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openApplication(id) {
    setBusy(true);
    try {
      const res = await api.get(`/verification/applications/${id}`);
      const detail = res.data?.data;
      setSelected(detail);
      const target = `${window.location.origin}/transport/verification?application=${id}`;
      setQr(await QRCode.toDataURL(target, { width: 180, margin: 1 }));
    } catch (err) {
      toast.error(err.response?.data?.message || 'เปิดคำขอไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function create(vehicleId) {
    setBusy(true);
    try {
      const res = await api.post('/verification/school/applications', { vehicle_id: vehicleId });
      toast.success('สร้างใบส่งตรวจแบบรวมแล้ว');
      await load();
      await openApplication(res.data.data.id);
    } catch (err) {
      const existing = err.response?.data?.errors?.[0]?.application_id;
      if (existing) await openApplication(existing);
      toast.error(err.response?.data?.message || 'สร้างคำขอไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function markReady() {
    setBusy(true);
    try {
      await api.post(`/verification/applications/${selected.id}/ready`);
      toast.success('เอกสารพร้อมพิมพ์และนำรถเข้าตรวจ');
      await load();
      await openApplication(selected.id);
    } catch (err) {
      toast.error(err.response?.data?.message || 'เปลี่ยนสถานะไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function review(approved) {
    if (!approved && !confirm('ยืนยันปฏิเสธคำขอนี้?')) return;
    setBusy(true);
    try {
      await api.post(`/verification/applications/${selected.id}/review`, { approved });
      toast.success(approved ? 'ตรวจสอบถูกต้อง คำขอพร้อมดำเนินการต่อ' : 'ปฏิเสธคำขอแล้ว');
      await load();
      if (approved) {
        await openApplication(selected.id);
      } else {
        setSelected(null);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'ตรวจสอบคำขอไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!confirm('ยืนยันยกเลิกคำขอนี้? เมื่อยกเลิกแล้วจะไม่สามารถนำกลับมาใช้ได้')) return;
    const reason = prompt('เหตุผลที่ยกเลิก (ถ้ามี):') ?? '';
    setBusy(true);
    try {
      await api.post(`/verification/applications/${selected.id}/cancel`, { reason: reason.trim() || null });
      toast.success('ยกเลิกคำขอแล้ว');
      await load();
      setSelected(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'ยกเลิกคำขอไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  const activeVehicleIds = useMemo(() => new Set(
    applications
      .filter(application => !CLOSED_STATUSES.has(application.status))
      .map(application => application.vehicle_id)
  ), [applications]);

  const heroMeta = [
    `${vehicles.length} รถในโรงเรียน`,
    `${statusCount(applications, ['INSPECTION_PENDING', 'READY_TO_PRINT', 'SUBMITTED'])} คำขอกำลังดำเนินการ`,
    `${statusCount(applications, ['PASSED'])} คำขอผ่านแล้ว`,
  ];

  if (loading) return <LoadingState />;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-3 sm:p-6">
      <div className="print:hidden">
        <CommandHero
          eyebrow="School vehicle safety workflow"
          title="ส่งตรวจและรับรองรถ"
          description="คนขับยื่นคำขอขึ้นทะเบียนรถ โรงเรียนตรวจสอบความถูกต้อง และขนส่งตรวจสภาพรถ ติดตามสถานะได้ตลอด"
          icon={ShieldCheck}
          meta={heroMeta}
          actions={(
            <button
              type="button"
              onClick={load}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-surface-raised px-4 py-2 text-sm font-semibold text-brand-900 transition hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <RefreshCw className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
              รีเฟรชข้อมูล
            </button>
          )}
        >
          <VerificationProgress selected={selected} />
        </CommandHero>
      </div>

      {error && <ErrorState message={error} />}

      {isGradeTeacher && (
        <AlertBanner
          variant="warn"
          icon={AlertTriangle}
          title="บัญชีครูประจำสายชั้นดูสถานะได้เท่านั้น"
          className="print:hidden"
        >
          การสร้างหรือยืนยันใบส่งตรวจต้องใช้บัญชีโรงเรียนหลัก
        </AlertBanner>
      )}

      {!selected && (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
            <AppCard className="print:hidden">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-ink">รถที่โรงเรียนใช้งาน</h2>
                  <p className="mt-1 text-sm text-ink-muted">เลือกคันที่ต้องการออกใบส่งตรวจ หรือเปิดคำขอที่กำลังดำเนินการ</p>
                </div>
                <StatusBadge variant="brand" size="lg">{vehicles.length} คัน</StatusBadge>
              </div>

              {vehicles.length === 0 ? (
                <EmptyState icon={Bus} title="ยังไม่มีรถรับส่ง" />
              ) : (
                <div className="grid gap-3 md:grid-cols-2 motion-safe:animate-fade-in-up motion-reduce:animate-none">
                  {vehicles.map(vehicle => {
                    const active = applications.find(application => (
                      application.vehicle_id === vehicle.id && activeVehicleIds.has(vehicle.id)
                    ));
                    return (
                      <VehicleRequestCard
                        key={vehicle.id}
                        vehicle={vehicle}
                        activeApplication={active}
                        disabled={isGradeTeacher}
                        busy={busy}
                        onCreate={create}
                        onOpen={openApplication}
                      />
                    );
                  })}
                </div>
              )}
            </AppCard>

            <div className="space-y-4 print:hidden">
              <VehiclePrivacyNotice />
              <AppCard padding="md">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-ink-muted" strokeWidth={2.2} aria-hidden="true" />
                  <h2 className="font-bold text-ink">ประวัติคำขอ</h2>
                </div>
                {applications.length === 0 ? (
                  <p className="mt-3 text-sm text-ink-muted">ยังไม่มีคำขอ</p>
                ) : (
                  <div className="mt-3 space-y-1">
                    {applications.map(application => (
                      <VerificationHistoryRow
                        key={application.id}
                        application={application}
                        onOpen={openApplication}
                      />
                    ))}
                  </div>
                )}
              </AppCard>
            </div>
          </div>
        </>
      )}

      {selected && (
        <VerificationPacket
          selected={selected}
          qr={qr}
          busy={busy}
          isGradeTeacher={isGradeTeacher}
          onBack={() => setSelected(null)}
          onMarkReady={markReady}
          onReview={review}
          onCancel={cancel}
        />
      )}

      {!selected && applications.some(application => application.status === 'PASSED') && (
        <AlertBanner variant="success" icon={CheckCircle2} className="print:hidden">
          มีรถที่ผ่านการรับรองแล้ว โรงเรียนสามารถใช้หน้าประวัติเพื่อติดตามอายุเอกสารและผลตรวจย้อนหลัง
        </AlertBanner>
      )}
    </div>
  );
}
