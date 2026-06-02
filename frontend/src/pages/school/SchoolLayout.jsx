import { Outlet } from 'react-router-dom';
import { Eye, Home, GraduationCap, Activity, FileText } from 'lucide-react';
import Layout from '../../components/Layout';
import MobileBottomNav from '../../components/MobileBottomNav';
import { useAuth } from '../../hooks/useAuth';
import { useAdminContext } from '../../hooks/useAdminContext';
import { AdminSchoolSelector, AdminNoScopeMessage } from '../../components/AdminScopeSelector';
import { StatusBadge } from '../../components/ui';
import { isGradeTeacher, getGradeScope } from '../../utils/authScope';

// Phase 10.8UX-B-2B — mobile bottom nav tabs for school role.
// All 4 destinations are read-allowed for both full school and grade-teacher
// sub-accounts, so a single tab set works for both — write actions like
// "ยืนยันแทนคนขับ" / "จัดการรถ" stay in the dashboard action row where the
// existing teacher-hiding logic already lives.
const SCHOOL_TABS = [
  { to: '/school',                end: true,  icon: Home,          label: 'หน้าแรก' },
  { to: '/school/students',       end: false, icon: GraduationCap, label: 'ค้นหา' },
  { to: '/school/live-vehicles',  end: false, icon: Activity,      label: 'ตำแหน่ง' },
  { to: '/reports/daily',         end: false, icon: FileText,      label: 'รายงาน' },
];

/**
 * Phase 7.11.4 — when a homeroom-teacher account is logged in,
 * render a single scope chip + read-only hint above every school
 * page. Backend has already filtered the data; this is just a
 * clear visual reminder of why the page looks narrower than usual.
 */
function TeacherScopeChip({ user }) {
  const grade = getGradeScope(user);
  if (!grade) return null;
  return (
    <div className="px-4 sm:px-6 pt-3">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-2">
        <StatusBadge variant="info" size="md" icon={Eye}>
          ขอบเขตข้อมูล: {grade}
        </StatusBadge>
        <span className="text-xs text-ink-muted">
          บัญชีครูประจำสายชั้น — ดูข้อมูลได้อย่างเดียว
        </span>
      </div>
    </div>
  );
}

export default function SchoolLayout() {
  const { user } = useAuth();
  const { schoolId } = useAdminContext();
  const isAdmin = user?.role === 'admin';
  const hasScope = isAdmin ? !!schoolId : !!user?.scope_id;
  const teacher = isGradeTeacher(user);

  return (
    <Layout bottomNav={<MobileBottomNav tabs={SCHOOL_TABS} />}>
      {isAdmin && <AdminSchoolSelector />}
      {teacher && <TeacherScopeChip user={user} />}
      {hasScope ? <Outlet /> : isAdmin ? <AdminNoScopeMessage type="school" /> : <Outlet />}
    </Layout>
  );
}
