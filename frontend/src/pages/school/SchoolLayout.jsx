import { Outlet } from 'react-router-dom';
import Layout from '../../components/Layout';
import MobileBottomNav from '../../components/MobileBottomNav';
import { SCHOOL_TABS } from '../../components/mobileTabs';
import { useAuth } from '../../hooks/useAuth';
import { useAdminContext } from '../../hooks/useAdminContext';
import { AdminSchoolSelector, AdminNoScopeMessage } from '../../components/AdminScopeSelector';
import TeacherScopeChip from '../../components/TeacherScopeChip';
import { isGradeTeacher } from '../../utils/authScope';

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
