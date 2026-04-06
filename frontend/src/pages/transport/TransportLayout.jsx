import { Outlet } from 'react-router-dom';
import Layout from '../../components/Layout';

export default function TransportLayout() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
