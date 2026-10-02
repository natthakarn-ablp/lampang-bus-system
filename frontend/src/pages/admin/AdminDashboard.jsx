import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, ClipboardList, Building2, Wrench, ChevronRight, RefreshCw,
} from 'lucide-react';
import api from '../../api/axios';
import {
  AppCard, AlertBanner, TodayBanner, TodoCards, KpiRingCard, DayBars, RankBars,
  FoldSection, RoleChip, pctOf, pctTone,
} from '../../components/ui';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import { PageTransition } from '../../lib/motion';
import { todayBangkok, bangkokDateDaysAgo } from '../../utils/thaiTime';
import useRecentDays from '../../hooks/useRecentDays';

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

  // ── Status banner ────────────────────────────────────────────────────────
  // /health sits outside /api and is not guaranteed to be proxied to the
  // backend on every host, so the banner is driven by the pending queues only.
  const pendingFailed = failed.includes('pending');
  const pendingTotal = Number(pending.total) || 0;
  const requestPage = (Number(pending.vehicle) || 0) > (Number(pending.student_transfer) || 0)
    ? '/admin/vehicle-requests'
    : '/admin/transfer-requests';
  const onlyRoster = pendingTotal > 0 && !pending.student_transfer && !pending.vehicle;
  const banner = pendingTotal > 0
    ? {
        variant: 'warn',
        title: `มีคำขอรออนุมัติ ${fmt(pendingTotal)} รายการ`,
        sub: `โอนย้ายนักเรียน ${fmt(pending.student_transfer)} · คำขอเกี่ยวกับรถ ${fmt(pending.vehicle)} · คำขอรายชื่อ ${fmt(pending.roster)}`,
        // Roster requests have no admin page — no CTA rather than a dead link.
        cta: onlyRoster ? undefined : { label: 'ตรวจคำขอ', to: requestPage },
      }
    : {
        variant: 'success',
        title: 'ระบบทำงานปกติ',
        sub: 'ไม่มีคำขอค้างรออนุมัติ',
      };

  // ── Todos (never repeat the banner's topic) ─────────────────────────────
  const todos = [];
  if (pendingTotal === 0 && !pendingFailed) {
    todos.push({
      key: 'pending', variant: 'success', count: 0, keepZero: true,
      title: 'คำขอรออนุมัติ', sub: 'โอนย้ายนักเรียน · คำขอเกี่ยวกับรถ',
      cta: { label: 'เปิดดู', to: '/admin/transfer-requests' },
    });
  }
  if (!failed.includes('needs-action')) {
    todos.push({
      key: 'users', variant: 'info', count: usersNeedingAction.total,
      title: 'ผู้ใช้ต้องดูแล', sub: 'ยังไม่เคยเข้าใช้ / ต้องเปลี่ยนรหัสผ่าน',
      cta: { label: 'ดูรายชื่อ', to: '/admin/users' },
    });
  }
  if (!failed.includes('audit')) {
    todos.push({
      key: 'deletes', variant: 'neutral', count: recentDeletes.total,
      title: 'รายการที่ถูกลบใน 24 ชม.', sub: 'ตรวจย้อนหลังได้ทุกรายการ',
      cta: { label: 'ดูประวัติ', to: `/admin/audit-logs?action=DELETE&date_from=${yesterday}` },
    });
  }

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const mPct = pctOf(data?.morning_done, data?.morning_total);
  const ePct = pctOf(data?.evening_done, data?.evening_total);
  const eveningNotStarted = (Number(data?.evening_done) || 0) === 0;
  const emergencies = Number(data?.recent_emergencies) || 0;

  // ── Right chart: pending requests by queue ──────────────────────────────
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

      {/* Scale of the system */}
      <div className="flex flex-wrap gap-2">
        {[
          ['นักเรียน', data?.total_students],
          ['โรงเรียน', data?.total_schools],
          ['รถรับส่ง', data?.total_vehicles],
          ['บัญชีที่เปิดใช้', userCounts.total == null ? null : Math.max(0, userCounts.total - (userCounts.inactive || 0))],
        ].map(([k, v]) => (
          <span key={k} className="bg-surface-raised border border-surface-border rounded-full px-4 py-1.5 text-sm text-ink-muted">
            <span className="font-bold text-ink tabular-nums">{v == null ? '-' : fmt(v)}</span> {k}
          </span>
        ))}
      </div>

      {failed.length > 0 && (
        <AlertBanner variant="danger" title="โหลดข้อมูลบางส่วนไม่สำเร็จ">
          ตัวเลขที่แสดงอาจไม่ครบถ้วน กดรีเฟรชเพื่อลองใหม่อีกครั้ง
        </AlertBanner>
      )}

      {!pendingFailed && <TodayBanner {...banner} />}

      <TodoCards items={todos} />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiRingCard
          label="ส่งเช้าทั้งจังหวัด"
          pct={mPct}
          value={mPct == null ? '-' : undefined}
          sub={`${fmt(data?.morning_done)} / ${fmt(data?.morning_total)} คน`}
          variant={pctTone(mPct)}
        />
        {eveningNotStarted ? (
          <KpiRingCard
            label="รับเย็น"
            value="-"
            sub="ยังไม่เริ่มรอบ"
            variant="neutral"
            chip="ยังไม่เริ่ม"
          />
        ) : (
          <KpiRingCard
            label="รับเย็น"
            pct={ePct}
            value={ePct == null ? '-' : undefined}
            sub={`${fmt(data?.evening_done)} / ${fmt(data?.evening_total)} คน`}
            variant={pctTone(ePct)}
          />
        )}
        <KpiRingCard
          label="เหตุฉุกเฉิน 7 วัน"
          value={emergencies}
          sub={emergencies > 0 ? 'ดูรายละเอียดที่หน้าเหตุฉุกเฉิน' : 'ไม่มีเหตุ'}
          variant={emergencies > 0 ? 'danger' : 'success'}
        />
        <KpiRingCard
          label="บัญชีที่เปิดใช้"
          value={userCounts.total == null ? '-' : Math.max(0, userCounts.total - (userCounts.inactive || 0))}
          sub={`ระงับ ${fmt(userCounts.inactive)} บัญชี`}
          variant="info"
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DayBars
          title="การรับส่งทั้งจังหวัด 7 วันล่าสุด (%)"
          days={trendDays || []}
          note={trendDays && trendDays.some(d => d.today) && eveningNotStarted ? 'รอบเย็นของวันนี้ยังไม่เริ่ม' : undefined}
        />
        <RankBars
          title="คำขอรออนุมัติแยกประเภท"
          sub="ทั้งระบบ"
          rows={queueRows}
          empty="ไม่มีคำขอค้าง"
        />
      </section>

      <div className="space-y-3">
        <FoldSection
          title="คำขอรายชื่อล่าสุด"
          subtitle={`รออนุมัติ ${fmt(pendingRosterRequests.total)} รายการ`}
        >
          {pendingRosterRequests.rows.length === 0 ? (
            <p className="text-sm text-ink-muted">ไม่มีคำขอรอดำเนินการ</p>
          ) : (
            <ul className="divide-y divide-surface-border">
              {pendingRosterRequests.rows.map(r => (
                <li key={r.id} className="py-2 text-sm flex justify-between gap-3">
                  <span className="text-ink truncate">{r.school_name || '-'}</span>
                  <span className="text-ink-muted shrink-0">{r.request_type === 'add' ? 'เพิ่ม' : 'ลบ'}</span>
                </li>
              ))}
            </ul>
          )}
        </FoldSection>

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
