import { Outlet } from 'react-router-dom';
import { Home, Building2, Activity, FileText } from 'lucide-react';
import Layout from '../../components/Layout';
import MobileBottomNav from '../../components/MobileBottomNav';
import { useAuth } from '../../hooks/useAuth';
import { useAdminContext } from '../../hooks/useAdminContext';
import { AdminAffiliationSelector, AdminNoScopeMessage } from '../../components/AdminScopeSelector';

// Phase 10.8UX-B-2B — mobile bottom nav tabs for affiliation role.
const AFFILIATION_TABS = [
  { to: '/affiliation',                 end: true,  icon: Home,      label: 'หน้าแรก' },
  { to: '/affiliation/schools',         end: false, icon: Building2, label: 'โรงเรียน' },
  { to: '/affiliation/live-vehicles',   end: false, icon: Activity,  label: 'ตำแหน่ง' },
  { to: '/reports/daily',               end: false, icon: FileText,  label: 'รายงาน' },
];

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
