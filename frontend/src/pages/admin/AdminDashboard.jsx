import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bus, GraduationCap, Building2, User, Users, ClipboardList,
  Wrench, ChevronRight, Sunrise, Sunset, Trash2,
} from 'lucide-react';
import api from '../../api/axios';
import { relativeTime } from '../../utils/datetime';
import {
  AppCard, AlertBanner, KPIGrid, KPIStat, DashboardSection, AttentionCard,
} from '../../components/ui';
import LoadingState from '../../components/LoadingState';
import { PageTransition } from '../../lib/motion';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [users, setUsers] = useState(null);
  const [usersNeedingAction, setUsersNeedingAction] = useState({ total: 0, rows: [] });
  const [pendingRosterRequests, setPendingRosterRequests] = useState({ total: 0, rows: [] });
  const [recentDeletes, setRecentDeletes] = useState({ total: 0, rows: [] });
  const [loading, setLoading] = useState(true);

  // Yesterday in YYYY-MM-DD for the audit-DELETE 24h window. Computed once
  // at mount via the useEffect below; also reused in the card 3 onJump
  // navigation target so the deep-link filter matches what the panel is
  // showing.
  const yesterday = new Date(Date.now() - 86400_000).toISOString().split('T')[0];

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    Promise.all([
      api.get('/province/dashboard').then(r => r.data.data).catch(() => null),
      api.get('/admin/users?per_page=5&is_active=false').then(r => r.data).catch(() => null),
      api.get('/admin/users-needing-action?limit=3').then(r => r.data?.data ?? null).catch(() => null),
      api.get('/admin/roster-requests-pending?limit=3').then(r => r.data?.data ?? null).catch(() => null),
      // Card 3 reuses existing audit-logs endpoint with DELETE filter.
      // Normalize the response to the same { total, rows } shape as cards
      // 1+2 so all three setters share an Array.isArray guard pattern.
      api.get(`/admin/audit-logs?action=DELETE&date_from=${yesterday}&date_to=${today}&per_page=3`)
        .then(r => ({ total: r.data?.meta?.total ?? 0, rows: r.data?.data ?? [] }))
        .catch(() => null),
    ])
      .then(([dash, u, una, prr, audit]) => {
        setData(dash);
        setUsers(u);
        if (una && Array.isArray(una.rows)) setUsersNeedingAction(una);
        if (prr && Array.isArray(prr.rows)) setPendingRosterRequests(prr);
        if (audit && Array.isArray(audit.rows)) setRecentDeletes(audit);
      })
      .finally(() => setLoading(false));
  }, [yesterday]);

  if (loading) return <LoadingState />;

  const totalUsers = users?.meta?.total ?? 0;

  // Status banner
  const issues = [];
  if ((data?.morning_pending ?? 0) > 0) issues.push(`รอส่งเช้า ${data.morning_pending} คน`);
  if ((data?.evening_pending ?? 0) > 0) issues.push(`รอรับเย็น ${data.evening_pending} คน`);
  if ((data?.recent_emergencies ?? 0) > 0) issues.push(`เหตุฉุกเฉิน ${data.recent_emergencies} ครั้ง`);

  const totalBase = (data?.morning_total ?? 0) + (data?.evening_total ?? 0);
  const notStarted = totalBase === 0 && issues.length === 0;

  // Render the attention panel only when one of the three governance
  // signals has content. Empty-all = the existing AlertBanner success
  // state covers it; no need for an empty hero panel.
  const hasAnyAttention = usersNeedingAction.total > 0
                       || pendingRosterRequests.total > 0
                       || recentDeletes.total > 0;

  return (
    <PageTransition>
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <header className="motion-safe:animate-fade-in-up">
        <h1 className="text-2xl sm:text-3xl font-bold text-ink leading-tight">ศูนย์ควบคุมระบบ</h1>
        <p className="text-sm text-ink-muted mt-1">ภาพรวมระบบรถรับส่งนักเรียนจังหวัดลำปาง</p>
      </header>

      {/* Status banner */}
      {notStarted ? (
        <AlertBanner variant="info" title="ยังไม่เริ่มดำเนินการวันนี้">รอข้อมูลรอบเช้า</AlertBanner>
      ) : issues.length > 0 ? (
        <AlertBanner variant="warn" title="สิ่งที่ต้องติดตามวันนี้">
          <ul className="space-y-0.5 mt-1">
            {issues.map((msg, i) => <li key={i}>{msg}</li>)}
          </ul>
        </AlertBanner>
      ) : (
        <AlertBanner variant="success" title="ระบบปกติ ไม่มีสิ่งที่ต้องติดตามเร่งด่วน" />
      )}

      {/* Phase 5 — Executive Attention Panel: governance signals */}
      {hasAnyAttention && (
        <AdminAttentionPanel
          usersNeedingAction={usersNeedingAction}
          pendingRosterRequests={pendingRosterRequests}
          recentDeletes={recentDeletes}
          onJumpUsers={() => navigate('/admin/users?is_active=false')}
          onJumpAudit={() => navigate(`/admin/audit-logs?action=DELETE&date_from=${yesterday}`)}
        />
      )}

      {/* Quick stats */}
      <KPIGrid cols={4} gap="sm">
        <KPIStat label="รถรับส่ง"    value={data?.total_vehicles ?? 0} icon={Bus}           variant="brand" />
        <KPIStat label="นักเรียน"    value={data?.total_students ?? 0} icon={GraduationCap} variant="brand" />
        <KPIStat label="โรงเรียน"    value={data?.total_schools ?? 0}  icon={Building2}     variant="brand" />
        <KPIStat label="ผู้ใช้งาน"   value={totalUsers}                 icon={User}          variant="brand" />
      </KPIGrid>

      {/* Quick actions */}
      <DashboardSection title="ทางลัดบริหาร">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ActionCard icon={Users}        title="จัดการผู้ใช้งาน" desc="สร้าง แก้ไข รีเซ็ตรหัสผ่าน"  onClick={() => navigate('/admin/users')}      />
          <ActionCard icon={ClipboardList} title="ประวัติการใช้งาน" desc="ตรวจสอบ audit log ทั้งระบบ"  onClick={() => navigate('/admin/audit-logs')} />
          <ActionCard icon={Building2}    title="จัดการโรงเรียน"  desc="ข้อมูลนักเรียน รถ ของโรงเรียน" onClick={() => navigate('/school')}           />
          <ActionCard icon={Wrench}       title="ตรวจสภาพรถ"      desc="ดูสถานะและบันทึกตรวจ"          onClick={() => navigate('/transport')}        />
        </div>
      </DashboardSection>

      {/* System overview */}
      {data && (
        <DashboardSection title="สรุประบบวันนี้">
          <AppCard padding="md">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <ProgressMini icon={Sunrise} label="ส่งเช้า" done={data.morning_done ?? 0} total={data.morning_total ?? 0} />
              <ProgressMini icon={Sunset}  label="รับเย็น" done={data.evening_done ?? 0} total={data.evening_total ?? 0} />
            </div>
          </AppCard>
        </DashboardSection>
      )}
    </div>
    </PageTransition>
  );
}

/* ── Admin attention panel: 3 governance cards above the KPI grid ── */
function AdminAttentionPanel({
  usersNeedingAction,
  pendingRosterRequests,
  recentDeletes,
  onJumpUsers,
  onJumpAudit,
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <AttentionCard
        icon={Users}
        title="ผู้ใช้ต้องดูแล"
        count={usersNeedingAction.total}
        variant={usersNeedingAction.total > 0 ? 'warn' : 'neutral'}
        items={usersNeedingAction.rows.slice(0, 3).map(u => ({
          key: u.id,
          primary: u.display_name || u.username,
          secondary: !u.is_active           ? 'บัญชีถูกระงับ'
                   : u.must_change_password ? 'ต้องเปลี่ยนรหัสผ่าน'
                   :                           '-',
        }))}
        onJump={onJumpUsers}
        emptyLabel="ผู้ใช้ทุกคนพร้อมใช้งาน"
      />
      <AttentionCard
        icon={ClipboardList}
        title="คำขอรออนุมัติ"
        count={pendingRosterRequests.total}
        variant={pendingRosterRequests.total > 5 ? 'danger'
               : pendingRosterRequests.total > 0 ? 'warn'
               :                                    'neutral'}
        items={pendingRosterRequests.rows.slice(0, 3).map(r => ({
          key: r.id,
          primary: r.school_name || '-',
          secondary: `${r.request_type === 'add' ? 'เพิ่ม' : 'ลบ'} · ${relativeTime(r.created_at)}`,
        }))}
        // No onJump — admin/roster-requests page doesn't exist yet
        // (deferred to Phase 6). AttentionCard's no-jump-target branch
        // omits the "ดูทั้งหมด →" affordance correctly.
        emptyLabel="ไม่มีคำขอรอดำเนินการ"
      />
      <AttentionCard
        icon={Trash2}
        title="ลบข้อมูล (24 ชม.)"
        count={recentDeletes.total}
        variant={recentDeletes.total > 5 ? 'danger'
               : recentDeletes.total > 0 ? 'warn'
               :                            'neutral'}
        items={recentDeletes.rows.slice(0, 3).map(a => ({
          key: a.id,
          primary: a.actor_name || '-',
          secondary: `${a.entity_type || '-'} · ${relativeTime(a.created_at)}`,
        }))}
        onJump={onJumpAudit}
        emptyLabel="ไม่มีการลบในรอบ 24 ชม."
      />
    </div>
  );
}

function ActionCard({ icon: Icon, title, desc, onClick }) {
  return (
    <AppCard
      as="button"
      padding="md"
      interactive
      onClick={onClick}
      className="text-left"
    >
      <div className="flex items-center gap-3">
        <span className="shrink-0 w-10 h-10 rounded-xl bg-brand-50 inline-flex items-center justify-center">
          <Icon className="w-5 h-5 text-brand-700" strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-ink">{title}</p>
          <p className="text-sm text-ink-muted">{desc}</p>
        </div>
        <ChevronRight className="w-4 h-4 text-ink-muted shrink-0" strokeWidth={2} aria-hidden="true" />
      </div>
    </AppCard>
  );
}

function ProgressMini({ icon: Icon, label, done, total }) {
  const notStarted = total === 0;
  const pct = notStarted ? 0 : Math.round((done / total) * 100);
  const isComplete = !notStarted && pct === 100;
  const pctTone = notStarted ? 'text-ink-muted'
                : isComplete ? 'text-success'
                : pct >= 80  ? 'text-warn'
                : 'text-danger';
  const barCls  = isComplete ? 'bg-success'
                : pct >= 80  ? 'bg-warn'
                : 'bg-danger';

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="inline-flex items-center gap-1.5 font-medium text-ink">
          {Icon && <Icon className="w-4 h-4 text-ink-muted" strokeWidth={2} />}
          {label}
        </span>
        <span className={`text-sm font-semibold tabular-nums ${pctTone}`}>
          {notStarted ? 'ยังไม่เริ่ม' : `${pct}%`}
        </span>
      </div>
      <div className="flex justify-between text-xs text-ink-muted mb-1">
        <span className="tabular-nums">{notStarted ? 'รอเริ่มรอบ' : `${done}/${total} คน`}</span>
      </div>
      <div className="w-full h-2 rounded-full overflow-hidden bg-surface">
        {!notStarted && <div className={`h-full ${barCls}`} style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}
