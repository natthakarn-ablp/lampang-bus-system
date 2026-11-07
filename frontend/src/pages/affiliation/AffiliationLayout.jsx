import { Outlet } from 'react-router-dom';
import Layout from '../../components/Layout';
import MobileBottomNav from '../../components/MobileBottomNav';
import { AFFILIATION_TABS } from '../../components/mobileTabs';
import { useAuth } from '../../hooks/useAuth';
import { useAdminContext } from '../../hooks/useAdminContext';
import { AdminAffiliationSelector, AdminNoScopeMessage } from '../../components/AdminScopeSelector';

export default function AffiliationLayout() {
  const { user } = useAuth();
  const { affiliationId } = useAdminContext();
  const isAdmin = user?.role === 'admin';
  const hasScope = isAdmin ? !!affiliationId : !!user?.scope_id;

  return (
    <Layout bottomNav={<MobileBottomNav tabs={AFFILIATION_TABS} />}>
      {isAdmin && <AdminAffiliationSelector />}
      {hasScope ? <Outlet /> : isAdmin ? <AdminNoScopeMessage type="affiliation" /> : <Outlet />}
    </Layout>
  );
}
