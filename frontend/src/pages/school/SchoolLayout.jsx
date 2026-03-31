import { Outlet } from 'react-router-dom';
import Layout from '../../components/Layout';

export default function SchoolLayout() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
