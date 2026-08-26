import { NavLink, Outlet } from 'react-router-dom';
import Layout from '../../components/Layout';
import { useAuth } from '../../hooks/useAuth';

const TABS = [
  { to: '/reports/daily',   label: 'รายวัน' },
  { to: '/reports/monthly', label: 'รายเดือน' },
  { to: '/reports/summary', label: 'สรุปภาพรวม' },
  // Policy report is province/admin-only (getPolicyReport 403s other roles).
  { to: '/reports/policy',  label: 'เชิงนโยบาย', roles: ['province', 'admin'] },
];

export default function ReportsLayout() {
  const { user } = useAuth();
  const tabs = TABS.filter((t) => !t.roles || t.roles.includes(user?.role));
  return (
    <Layout>
      {/* Report sub-navigation tabs */}
      <div className="border-b border-surface-border bg-surface-raised px-4 sm:px-6 pt-3">
        <nav className="flex gap-1 overflow-x-auto" aria-label="หมวดรายงาน">
          {tabs.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `focus-ring inline-flex items-center whitespace-nowrap px-4 min-h-[44px] text-sm rounded-t-lg transition ${
                  isActive
                    ? 'bg-brand-50 text-brand-700 font-semibold border-b-2 border-brand-600'
                    : 'text-ink-muted hover:text-ink hover:bg-surface active:bg-surface-border'
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
