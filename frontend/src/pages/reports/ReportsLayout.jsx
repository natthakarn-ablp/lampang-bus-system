import { NavLink, Outlet } from 'react-router-dom';
import Layout from '../../components/Layout';
import MobileBottomNav from '../../components/MobileBottomNav';
import { ROLE_TABS } from '../../components/mobileTabs';
import TeacherScopeChip from '../../components/TeacherScopeChip';
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
  // School and affiliation reach รายงาน from their bottom bar; keep it here so
  // they can tap back to เช็กชื่อ / หน้าแรก. Province/admin have no bar.
  const bottomTabs = ROLE_TABS[user?.role];
  return (
    <Layout bottomNav={bottomTabs ? <MobileBottomNav tabs={bottomTabs} /> : null}>
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
      {/* Every figure below is filtered to this teacher's grade. Without the chip
          the headings read like the whole school's numbers. */}
      <TeacherScopeChip user={user} note="ตัวเลขทุกส่วนในหน้านี้นับเฉพาะสายชั้นของคุณ" />
      <Outlet />
    </Layout>
  );
}
