import { Outlet } from 'react-router-dom';
import Layout from '../../components/Layout';
import { useAuth } from '../../hooks/useAuth';
import { useAdminContext } from '../../hooks/useAdminContext';
import { AdminSchoolSelector, AdminNoScopeMessage } from '../../components/AdminScopeSelector';

export default function SchoolLayout() {
  const { user } = useAuth();
  const { schoolId } = useAdminContext();
  const isAdmin = user?.role === 'admin';
  const hasScope = isAdmin ? !!schoolId : !!user?.scope_id;

  return (
    <Layout>
      {isAdmin && <AdminSchoolSelector />}
      {hasScope ? <Outlet /> : isAdmin ? <AdminNoScopeMessage type="school" /> : <Outlet />}
    </Layout>
  );
}
