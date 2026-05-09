import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bus, GraduationCap, Building2, User, Users, ClipboardList,
  Wrench, ChevronRight, Sunrise, Sunset,
} from 'lucide-react';
import api from '../../api/axios';
import {
  AppCard, AlertBanner, KPIGrid, KPIStat, DashboardSection,
} from '../../components/ui';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [users, setUsers] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/province/dashboard').then(r => r.data.data).catch(() => null),
      api.get('/admin/users?per_page=5&is_active=false').then(r => r.data).catch(() => null),
    ])
      .then(([dash, u]) => { setData(dash); setUsers(u); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-ink-muted py-10 text-center text-lg">กำลังโหลด…</p>;

  const totalUsers = users?.meta?.total ?? 0;

  // Status banner
  const issues = [];
  if ((data?.morning_pending ?? 0) > 0) issues.push(`รอส่งเช้า ${data.morning_pending} คน`);
  if ((data?.evening_pending ?? 0) > 0) issues.push(`รอรับเย็น ${data.evening_pending} คน`);
  if ((data?.recent_emergencies ?? 0) > 0) issues.push(`เหตุฉุกเฉิน ${data.recent_emergencies} ครั้ง`);

  const totalBase = (data?.morning_total ?? 0) + (data?.evening_total ?? 0);
  const notStarted = totalBase === 0 && issues.length === 0;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <header>
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
  );
}

function ActionCard({ icon: Icon, title, desc, onClick }) {
  return (
    <AppCard
      as="button"
      padding="md"
      onClick={onClick}
      className="text-left hover:shadow-elevate hover:-translate-y-0.5 transition cursor-pointer"
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
