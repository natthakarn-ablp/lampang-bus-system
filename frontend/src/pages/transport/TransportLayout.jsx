import { Outlet } from 'react-router-dom';
import { ClipboardList, Home, Map, ShieldCheck } from 'lucide-react';
import Layout from '../../components/Layout';
import MobileBottomNav from '../../components/MobileBottomNav';

const TRANSPORT_TABS = [
  { to: '/transport',              end: true,  icon: Home,          label: 'หน้าแรก' },
  { to: '/transport/verification', end: false, icon: ShieldCheck,   label: 'ตรวจเอกสาร' },
  { to: '/transport/inspections',  end: false, icon: ClipboardList, label: 'ตรวจรถ' },
  { to: '/transport/pickup-map',   end: false, icon: Map,           label: 'แผนที่' },
];

export default function TransportLayout() {
  return (
    <Layout bottomNav={<MobileBottomNav tabs={TRANSPORT_TABS} />}>
      <Outlet />
    </Layout>
  );
}
