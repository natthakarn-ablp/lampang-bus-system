import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, ClipboardList, Building2, Wrench, ChevronRight, RefreshCw,
} from 'lucide-react';
import api from '../../api/axios';
import {
  AppCard, AlertBanner, DayBars, RankBars, FoldSection, RoleChip,
} from '../../components/ui';
import {
  StatusHero, ActionList, StatTile, StatGrid, TravelLeaveSummary, roundStatus,
} from '../../components/dashboard';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import { PageTransition } from '../../lib/motion';
import { todayBangkok, bangkokDateDaysAgo } from '../../utils/thaiTime';
import useRecentDays, { RECENT_DAYS_FAILED } from '../../hooks/useRecentDays';

const EMPTY_SIGNAL = { total: 0, rows: [] };
const EMPTY_PENDING = { total: 0, student_transfer: 0, vehicle: 0, roster: 0 };

const fmt = n => Number(n || 0).toLocaleString('th-TH');

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [userCounts, setUserCounts] = useState({ total: null, inactive: 0 });
  const [usersNeedingAction, setUsersNeedingAction] = useState(EMPTY_SIGNAL);
  const [pendingRosterRequests, setPendingRosterRequests] = useState(EMPTY_SIGNAL);
  const [recentDeletes, setRecentDeletes] = useState(EMPTY_SIGNAL);
  const [pending, setPending] = useState(EMPTY_PENDING);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState([]);
  const [loadedAt, setLoadedAt] = useState(null);
  const trendDays = useRecentDays('province', 7);

  const yesterday = bangkokDateDaysAgo(1);

  const load = useCallback(() => {
    setLoading(true);
    const today = todayBangkok();
    const failures = [];
    const track = (label, p) => p.catch(() => { failures.push(label); return null; });

    Promise.all([
      track('dashboard', api.get('/province/dashboard').then(r => r.data.data)),
      // Total accounts: `is_active` is an optional filter, so omitting it counts
      // every non-deleted account. per_page=1 — only meta.total is used.
      track('users', api.get('/admin/users?per_page=1').then(r => r.data?.meta?.total ?? 0)),
      // Suspended accounts, kept as their own number (not mislabelled as the total).
      track('inactive', api.get('/admin/users?per_page=1&is_active=false').then(r => r.data?.meta?.total ?? 0)),
      track('needs-action', api.get('/admin/users-needing-action?limit=3').then(r => r.data?.data ?? null)),
      track('roster', api.get('/admin/roster-requests-pending?limit=3').then(r => r.data?.data ?? null)),
      track('audit', api.get(`/admin/audit-logs?action=DELETE&date_from=${yesterday}&date_to=${today}&per_page=3`)
        .then(r => ({ total: r.data?.meta?.total ?? 0, rows: r.data?.data ?? [] }))),
      // The same three queues the admin bell counts.
      track('pending', api.get('/admin/pending-requests-count').then(r => r.data?.data ?? null)),
    ])
      .then(([dash, total, inactive, una, prr, audit, pend]) => {
        setData(dash);
        setUserCounts({ total, inactive: inactive ?? 0 });
        if (una && Array.isArray(una.rows)) setUsersNeedingAction(una);
        if (prr && Array.isArray(prr.rows)) setPendingRosterRequests(prr);
        if (audit && Array.isArray(audit.rows)) setRecentDeletes(audit);
        if (pend) setPending({ ...EMPTY_PENDING, ...pend });
        // One failed call must not blank the page — show what loaded and say
        // plainly that part of it did not.
        setFailed(failures);
        setLoadedAt(new Date());
      })
      .finally(() => setLoading(false));
  }, [yesterday]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;

  const freshness = loadedAt
    ? loadedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
    : null;
  const todayLabel = new Date().toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const dashFailed = failed.includes('dashboard') || !data;
  const pendingFailed = failed.includes('pending');
  const pendingTotal = Number(pending.total) || 0;
  const emergencies = Number(data?.recent_emergencies) || 0;

  // ── Compact province round summary (same helper as every dashboard) ──
  const dateIso = data?.date ? String(data.date).slice(0, 10) : undefined;
  const isSchoolDay = typeof data?.is_school_day === 'boolean' ? data.is_school_day : undefined;
  const mStatus = roundStatus({ session: 'morning', done: data?.morning_done, expected: data?.morning_total, date: dateIso, isSchoolDay, unavailable: dashFailed });
  const eStatus = roundStatus({ session: 'evening', done: data?.evening_done, expected: data?.evening_total, date: dateIso, isSchoolDay, unavailable: dashFailed });

  // ── What the admin has to act on, most urgent first ──
  const actions = [
    {
      key: 'transfer', tone: 'warn', count: pending.student_transfer, unavailable: pendingFailed,
      title: 'คำขอโอนย้ายนักเรียน', sub: 'ตรวจและอนุมัติคำขอข้ามโรงเรียน',
      to: '/admin/transfer-requests', actionLabel: 'ตรวจคำขอ',
    },
    {
      key: 'vehicle', tone: 'warn', count: pending.vehicle, unavailable: pendingFailed,
      title: 'คำขอเกี่ยวกับรถ', sub: 'กู้คืนรถ / ใช้รถร่วมกัน รออนุมัติ',
      to: '/admin/vehicle-requests', actionLabel: 'ตรวจคำขอ',
    },
    {
      // Roster requests have no admin page — shown as information, not a dead link.
      key: 'roster', tone: 'info', count: pending.roster, unavailable: pendingFailed,
      title: 'คำขอรายชื่อจากโรงเรียน', sub: 'รอเขตหรือโรงเรียนดำเนินการ',
    },
    {
      key: 'emergency', tone: 'warn', count: emergencies, unavailable: failed.includes('dashboard'),
      title: 'เหตุฉุกเฉินใน 7 วัน', sub: 'ตรวจผลการแก้ไข',
      to: '/province/emergencies', actionLabel: 'ดูเหตุฉุกเฉิน',
    },
    {
      key: 'users', tone: 'info', count: usersNeedingAction.total, unavailable: failed.includes('needs-action'),
      title: 'ผู้ใช้ที่ต้องดูแล', sub: 'ยังไม่เคยเข้าใช้ หรือต้องเปลี่ยนรหัสผ่าน',
      to: '/admin/users', actionLabel: 'ดูรายชื่อ',
    },
    {
      key: 'deletes', tone: 'info', count: recentDeletes.total, unavailable: failed.includes('audit'),
      title: 'รายการที่ถูกลบใน 24 ชั่วโมง', sub: 'ตรวจย้อนหลังได้ทุกรายการ',
      to: `/admin/audit-logs?action=DELETE&date_from=${yesterday}`, actionLabel: 'ดูประวัติ',
    },
  ];

  // ── Pending requests by queue ──
  const queues = [
    { key: 'st', label: 'โอนย้ายนักเรียน', n: Number(pending.student_transfer) || 0 },
    { key: 'vh', label: 'คำขอเกี่ยวกับรถ', n: Number(pending.vehicle) || 0 },
    { key: 'rs', label: 'คำขอรายชื่อ', n: Number(pending.roster) || 0 },
  ];
  const qMax = Math.max(1, ...queues.map(q => q.n));
  const queueRows = pendingTotal > 0
    ? queues.map(q => ({
        key: q.key, label: q.label, width: (q.n / qMax) * 100,
        text: `${fmt(q.n)} รายการ`, variant: q.n > 0 ? 'warn' : 'success',
      }))
    : [];
  const activeAccounts = userCounts.total == null ? null : Math.max(0, userCounts.total - (userCounts.inactive || 0));

  return (
    <PageTransition>
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col gap-2">
        <RoleChip role="admin" />
        <PageHeader
          title="ศูนย์ควบคุมระบบ"
          subtitle={todayLabel}
          meta={freshness ? `อัปเดตล่าสุด ${freshness} น.` : undefined}
          actions={
            <button
              type="button"
              onClick={load}
              className="focus-ring inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg border border-surface-border bg-surface-raised text-sm font-medium text-ink hover:bg-surface active:bg-surface-border transition"
            >
              <RefreshCw className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
              รีเฟรช
            </button>
          }
        />
      </div>

      {failed.length > 0 && (
        <AlertBanner variant="danger" title="โหลดข้อมูลบางส่วนไม่สำเร็จ">
          ตัวเลขที่แสดงอาจไม่ครบถ้วน กดรีเฟรชเพื่อลองใหม่อีกครั้ง
        </AlertBanner>
      )}

      {/* Admin acts on the queues first; the province summary comes second. */}
      <ActionList
        items={actions}
        emptyText="ไม่มีคำขอหรืองานค้าง ระบบทำงานปกติ"
      />

      <StatusHero
        eyebrow="ภาพรวมทั้งจังหวัดวันนี้"
        rounds={[
          { status: mStatus, to: '/reports/daily', title: 'รอบเช้า (ส่งถึงโรงเรียน)' },
          { status: eStatus, to: '/reports/daily', title: 'รอบเย็น (ส่งถึงบ้าน)' },
        ]}
        action={{ label: 'ดูภาพรวมจังหวัด', to: '/province' }}
      />

      <StatGrid label="ขนาดของระบบ">
        <StatTile label="นักเรียน" value={data?.total_students} unit="คน" unavailable={dashFailed} />
        <StatTile label="โรงเรียน" value={data?.total_schools} unavailable={dashFailed} />
        <StatTile label="รถรับส่ง" value={data?.total_vehicles} unit="คัน" unavailable={dashFailed} />
        <StatTile
          label="บัญชีที่เปิดใช้" value={activeAccounts} unavailable={activeAccounts == null}
          sub={`ระงับ ${fmt(userCounts.inactive)} บัญชี`}
        />
      </StatGrid>

      <TravelLeaveSummary data={dashFailed ? {} : data} />

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DayBars
          title="การรับส่งทั้งจังหวัด 7 วันล่าสุด (%)"
          days={trendDays || []}
          failed={trendDays === RECENT_DAYS_FAILED}
          note={trendDays && trendDays.some(d => d.today) && eStatus.state === 'not_yet' ? 'รอบเย็นของวันนี้ยังไม่ถึงเวลา' : undefined}
        />
        <RankBars
          title="คำขอรออนุมัติแยกประเภท"
          sub="ทั้งระบบ"
          rows={queueRows}
          empty="ไม่มีคำขอค้าง"
        />
      </section>

      <div className="space-y-3">
        {pendingRosterRequests.rows.length > 0 && (
          <FoldSection
            title="คำขอรายชื่อล่าสุด"
            subtitle={`รออนุมัติ ${fmt(pendingRosterRequests.total)} รายการ`}
          >
            <ul className="divide-y divide-surface-border">
              {pendingRosterRequests.rows.map(r => (
                <li key={r.id} className="py-2 text-sm flex justify-between gap-3">
                  <span className="text-ink truncate">{r.school_name || '-'}</span>
                  <span className="text-ink-muted shrink-0">{r.request_type === 'add' ? 'เพิ่ม' : 'ลบ'}</span>
                </li>
              ))}
            </ul>
          </FoldSection>
        )}

        <FoldSection title="ทางลัดผู้ดูแลระบบ" subtitle="ผู้ใช้งาน · ประวัติการใช้งาน · โรงเรียน · ตรวจสภาพรถ">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <ActionCard icon={Users}         title="จัดการผู้ใช้งาน" desc="สร้าง แก้ไข รีเซ็ตรหัสผ่าน" onClick={() => navigate('/admin/users')} />
            <ActionCard icon={ClipboardList} title="ประวัติการใช้งาน" desc="ตรวจสอบ audit log"        onClick={() => navigate('/admin/audit-logs')} />
            <ActionCard icon={Building2}     title="จัดการโรงเรียน"  desc="นักเรียนและรถของโรงเรียน"  onClick={() => navigate('/school')} />
            <ActionCard icon={Wrench}        title="ตรวจสภาพรถ"      desc="สถานะและบันทึกตรวจ"        onClick={() => navigate('/transport')} />
          </div>
        </FoldSection>
      </div>
    </div>
    </PageTransition>
  );
}

/** Compact shortcut tile. */
function ActionCard({ icon: Icon, title, desc, onClick }) {
  return (
    <AppCard as="button" padding="sm" interactive onClick={onClick} className="text-left">
      <div className="flex items-center gap-2.5">
        <span className="shrink-0 w-9 h-9 rounded-lg bg-brand-50 inline-flex items-center justify-center">
          <Icon className="w-[18px] h-[18px] text-brand-700" strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-ink text-sm leading-tight truncate">{title}</p>
          <p className="text-caption text-ink-muted truncate">{desc}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-ink-muted shrink-0" strokeWidth={2} aria-hidden="true" />
      </div>
    </AppCard>
  );
}
