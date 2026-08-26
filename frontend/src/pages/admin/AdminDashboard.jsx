import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bus, GraduationCap, Building2, User, Users, ClipboardList,
  Wrench, ChevronRight, Trash2, RefreshCw,
} from 'lucide-react';
import api from '../../api/axios';
import { relativeTime } from '../../utils/datetime';
import {
  AppCard, AlertBanner, KPIGrid, KPIStat, DashboardSection,
  AttentionQueue, DailyOperationStatus,
} from '../../components/ui';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import { PageTransition } from '../../lib/motion';

const EMPTY_SIGNAL = { total: 0, rows: [] };

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [userCounts, setUserCounts] = useState({ total: null, inactive: 0 });
  const [usersNeedingAction, setUsersNeedingAction] = useState(EMPTY_SIGNAL);
  const [pendingRosterRequests, setPendingRosterRequests] = useState(EMPTY_SIGNAL);
  const [recentDeletes, setRecentDeletes] = useState(EMPTY_SIGNAL);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState([]);
  const [loadedAt, setLoadedAt] = useState(null);

  const yesterday = new Date(Date.now() - 86400_000).toISOString().split('T')[0];

  const load = useCallback(() => {
    setLoading(true);
    const today = new Date().toISOString().split('T')[0];
    const failures = [];
    const track = (label, p) => p.catch(() => { failures.push(label); return null; });

    Promise.all([
      track('dashboard', api.get('/province/dashboard').then(r => r.data.data)),
      // Total accounts. `is_active` is an OPTIONAL filter on this endpoint, so
      // omitting it counts every account with is_deleted = FALSE — which is
      // what "ผู้ใช้งานทั้งหมด" means. per_page=1 keeps the payload to a single
      // row; only meta.total is used.
      //
      // The previous code read meta.total off the `is_active=false` request
      // below and rendered it as the total, so the KPI was really showing the
      // number of SUSPENDED accounts — which is why it read 0 on a system with
      // 276 users. Same endpoint, same permissions, no backend change.
      track('users', api.get('/admin/users?per_page=1').then(r => r.data?.meta?.total ?? 0)),
      // Suspended accounts, kept as its own metric rather than mislabelled as
      // the total.
      track('inactive', api.get('/admin/users?per_page=1&is_active=false').then(r => r.data?.meta?.total ?? 0)),
      track('needs-action', api.get('/admin/users-needing-action?limit=3').then(r => r.data?.data ?? null)),
      track('roster', api.get('/admin/roster-requests-pending?limit=3').then(r => r.data?.data ?? null)),
      track('audit', api.get(`/admin/audit-logs?action=DELETE&date_from=${yesterday}&date_to=${today}&per_page=3`)
        .then(r => ({ total: r.data?.meta?.total ?? 0, rows: r.data?.data ?? [] }))),
    ])
      .then(([dash, total, inactive, una, prr, audit]) => {
        setData(dash);
        setUserCounts({ total, inactive: inactive ?? 0 });
        if (una && Array.isArray(una.rows)) setUsersNeedingAction(una);
        if (prr && Array.isArray(prr.rows)) setPendingRosterRequests(prr);
        if (audit && Array.isArray(audit.rows)) setRecentDeletes(audit);
        // A single failed call must not blank the page — show what loaded and
        // say plainly which part did not.
        setFailed(failures);
        setLoadedAt(new Date());
      })
      .finally(() => setLoading(false));
  }, [yesterday]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState />;

  const freshness = loadedAt
    ? loadedAt.toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  const signals = [
    {
      key: 'users',
      unknown: failed.includes('needs-action'),
      icon: Users,
      title: 'ผู้ใช้ต้องดูแล',
      count: usersNeedingAction.total,
      variant: 'warn',
      items: usersNeedingAction.rows.slice(0, 3).map(u => ({
        key: u.id,
        primary: u.display_name || u.username,
        secondary: !u.is_active           ? 'บัญชีถูกระงับ'
                 : u.must_change_password ? 'ต้องเปลี่ยนรหัสผ่าน'
                 :                           '-',
      })),
      onJump: () => navigate('/admin/users?is_active=false'),
      emptyLabel: 'ผู้ใช้ทุกคนพร้อมใช้งาน',
    },
    {
      key: 'roster',
      unknown: failed.includes('roster'),
      icon: ClipboardList,
      title: 'คำขอรออนุมัติ',
      count: pendingRosterRequests.total,
      variant: pendingRosterRequests.total > 5 ? 'danger' : 'warn',
      items: pendingRosterRequests.rows.slice(0, 3).map(r => ({
        key: r.id,
        primary: r.school_name || '-',
        secondary: `${r.request_type === 'add' ? 'เพิ่ม' : 'ลบ'} · ${relativeTime(r.created_at)}`,
      })),
      // No onJump — there is no admin roster-requests page yet, and the spec
      // forbids a CTA pointing at a route that does not exist.
      emptyLabel: 'ไม่มีคำขอรอดำเนินการ',
    },
    {
      key: 'deletes',
      unknown: failed.includes('audit'),
      icon: Trash2,
      title: 'ลบข้อมูล (24 ชม.)',
      count: recentDeletes.total,
      variant: recentDeletes.total > 5 ? 'danger' : 'warn',
      items: recentDeletes.rows.slice(0, 3).map(a => ({
        key: a.id,
        primary: a.actor_name || '-',
        secondary: `${a.entity_type || '-'} · ${relativeTime(a.created_at)}`,
      })),
      onJump: () => navigate(`/admin/audit-logs?action=DELETE&date_from=${yesterday}`),
      emptyLabel: 'ไม่มีการลบในรอบ 24 ชม.',
    },
  ];

  return (
    <PageTransition>
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="ศูนย์ควบคุมระบบ"
        subtitle="ภาพรวมการเดินรถและงานที่ต้องดำเนินการวันนี้"
        meta={freshness ? `ข้อมูล ณ ${freshness}` : undefined}
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

      {failed.length > 0 && (
        <AlertBanner variant="danger" title="โหลดข้อมูลบางส่วนไม่สำเร็จ">
          ตัวเลขที่แสดงอาจไม่ครบถ้วน กดรีเฟรชเพื่อลองใหม่อีกครั้ง
        </AlertBanner>
      )}

      {/* 1 — how is today going */}
      <DashboardSection title="สถานะการเดินรถวันนี้">
        <DailyOperationStatus
          morningDone={data?.morning_done ?? 0}
          morningTotal={data?.morning_total ?? 0}
          eveningDone={data?.evening_done ?? 0}
          eveningTotal={data?.evening_total ?? 0}
          emergencies={data?.recent_emergencies ?? 0}
          // freshness is already on the page header — repeating it here would
          // just be the same timestamp twice on one screen.
        />
      </DashboardSection>

      {/* 2 — what needs a decision */}
      <DashboardSection title="สิ่งที่ต้องดำเนินการ">
        <AttentionQueue signals={signals} />
      </DashboardSection>

      {/* 3 — scale of the system */}
      <DashboardSection title="ข้อมูลระบบ">
        <KPIGrid cols={4} gap="sm">
          <KPIStat label="รถรับส่ง"  value={data?.total_vehicles ?? 0} icon={Bus}           variant="brand" />
          <KPIStat label="นักเรียน"  value={data?.total_students ?? 0} icon={GraduationCap} variant="brand" />
          <KPIStat label="โรงเรียน"  value={data?.total_schools ?? 0}  icon={Building2}     variant="brand" />
          <KPIStat
            label="ผู้ใช้งานทั้งหมด"
            value={userCounts.total ?? 0}
            icon={User}
            variant="brand"
            hint={userCounts.inactive > 0 ? `ระงับอยู่ ${userCounts.inactive.toLocaleString('th-TH')} บัญชี` : undefined}
          />
        </KPIGrid>
      </DashboardSection>

      {/* 4 — where to go next */}
      <DashboardSection title="ทางลัดบริหาร">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <ActionCard icon={Users}         title="จัดการผู้ใช้งาน" desc="สร้าง แก้ไข รีเซ็ตรหัสผ่าน" onClick={() => navigate('/admin/users')} />
          <ActionCard icon={ClipboardList} title="ประวัติการใช้งาน" desc="ตรวจสอบ audit log"        onClick={() => navigate('/admin/audit-logs')} />
          <ActionCard icon={Building2}     title="จัดการโรงเรียน"  desc="นักเรียนและรถของโรงเรียน"  onClick={() => navigate('/school')} />
          <ActionCard icon={Wrench}        title="ตรวจสภาพรถ"      desc="สถานะและบันทึกตรวจ"        onClick={() => navigate('/transport')} />
        </div>
      </DashboardSection>
    </div>
    </PageTransition>
  );
}

/**
 * Compact shortcut tile. The previous version stacked a 40px icon chip beside
 * two lines of text at `padding=md`, which made four shortcuts taller than the
 * KPI row above them. Same information, roughly half the height.
 */
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
