import { Outlet } from 'react-router-dom';
import Layout from '../../components/Layout';

/**
 * Shared shell for all /driver/* pages.
 * Renders the sidebar via Layout and lets React Router
 * swap the main content via <Outlet />.
 */
export default function DriverLayout() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
