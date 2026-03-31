import { Outlet } from 'react-router-dom';
import Layout from '../../components/Layout';

export default function AffiliationLayout() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
