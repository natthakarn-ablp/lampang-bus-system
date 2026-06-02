import { Outlet } from 'react-router-dom';
import { Home, Building2, Activity, FileText } from 'lucide-react';
import Layout from '../../components/Layout';
import MobileBottomNav from '../../components/MobileBottomNav';

// Phase 10.8UX-B-2B — mobile bottom nav tabs for province role.
const PROVINCE_TABS = [
  { to: '/province',                end: true,  icon: Home,      label: 'หน้าแรก' },
  { to: '/province/schools',        end: false, icon: Building2, label: 'โรงเรียน' },
  { to: '/province/live-vehicles',  end: false, icon: Activity,  label: 'ตำแหน่ง' },
  { to: '/reports/daily',           end: false, icon: FileText,  label: 'รายงาน' },
];

export default function ProvinceLayout() {
  return (
    <Layout bottomNav={<MobileBottomNav tabs={PROVINCE_TABS} />}>
      <Outlet />
    </Layout>
  );
}
