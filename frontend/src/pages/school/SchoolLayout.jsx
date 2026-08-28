import { Outlet } from 'react-router-dom';
import { Home, GraduationCap, Activity, FileText } from 'lucide-react';
import Layout from '../../components/Layout';
import MobileBottomNav from '../../components/MobileBottomNav';
import { useAuth } from '../../hooks/useAuth';
import { useAdminContext } from '../../hooks/useAdminContext';
import { AdminSchoolSelector, AdminNoScopeMessage } from '../../components/AdminScopeSelector';
import TeacherScopeChip from '../../components/TeacherScopeChip';
import { isGradeTeacher } from '../../utils/authScope';

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
