import { Outlet } from 'react-router-dom';
import Layout from '../../components/Layout';
import MobileBottomNav from '../../components/MobileBottomNav';

export default function DriverLayout() {
  return (
    <Layout bottomNav={<MobileBottomNav />}>
      <Outlet />
    </Layout>
  );
}
