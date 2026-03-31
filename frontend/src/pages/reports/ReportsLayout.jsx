import { NavLink, Outlet } from 'react-router-dom';
import Layout from '../../components/Layout';

const TABS = [
  { to: '/reports/daily',   label: 'รายวัน' },
  { to: '/reports/monthly', label: 'รายเดือน' },
  { to: '/reports/summary', label: 'สรุปภาพรวม' },
];

export default function ReportsLayout() {
  return (
    <Layout>
      {/* Report sub-navigation tabs */}
      <div className="border-b border-gray-200 bg-white px-6 pt-4">
        <nav className="flex gap-1">
          {TABS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `px-4 py-2 text-sm rounded-t-lg transition ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </Layout>
  );
}
