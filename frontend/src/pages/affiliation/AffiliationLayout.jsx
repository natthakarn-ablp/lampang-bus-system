import { Outlet } from 'react-router-dom';
import Layout from '../../components/Layout';
import { useAuth } from '../../hooks/useAuth';
import { useAdminContext } from '../../hooks/useAdminContext';
import { AdminAffiliationSelector, AdminNoScopeMessage } from '../../components/AdminScopeSelector';

export default function AffiliationLayout() {
  const { user } = useAuth();
  const { affiliationId } = useAdminContext();
  const isAdmin = user?.role === 'admin';
  const hasScope = isAdmin ? !!affiliationId : !!user?.scope_id;

  return (
    <Layout>
      {isAdmin && <AdminAffiliationSelector />}
      {hasScope ? <Outlet /> : isAdmin ? <AdminNoScopeMessage type="affiliation" /> : <Outlet />}
    </Layout>
  );
}
