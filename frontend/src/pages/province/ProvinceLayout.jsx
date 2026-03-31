import { Outlet } from 'react-router-dom';
import Layout from '../../components/Layout';

export default function ProvinceLayout() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
