import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const DRIVER_NAV = [
  { to: '/driver',           label: 'ภาพรวมวันนี้' },
  { to: '/driver/roster',    label: 'รายชื่อนักเรียน' },
  { to: '/driver/emergency', label: 'แจ้งเหตุฉุกเฉิน' },
];

const SCHOOL_NAV = [
  { to: '/school',             label: 'ภาพรวมโรงเรียน' },
  { to: '/school/students',    label: 'ค้นหานักเรียน' },
  { to: '/school/vehicles',    label: 'รถรับส่ง' },
  { to: '/school/status',      label: 'สถานะวันนี้' },
  { to: '/school/emergencies', label: 'เหตุฉุกเฉิน' },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const NAV_MAP = { driver: DRIVER_NAV, school: SCHOOL_NAV };
  const navItems = NAV_MAP[user?.role] || [];

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <aside className="w-56 min-h-screen bg-blue-800 text-white flex flex-col">
      {/* Brand */}
      <div className="px-5 py-6 border-b border-blue-700">
        <p className="font-bold text-sm leading-tight">ระบบรถรับส่งนักเรียน</p>
        <p className="text-blue-300 text-xs mt-0.5">จังหวัดลำปาง</p>
      </div>

      {/* User info */}
      <div className="px-5 py-4 border-b border-blue-700">
        <p className="text-xs text-blue-300">เข้าสู่ระบบในฐานะ</p>
        <p className="font-semibold text-sm truncate">{user?.display_name || user?.username}</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to.split('/').length === 2} // 'end' only for top-level paths
            className={({ isActive }) =>
              `block px-4 py-2.5 rounded-lg text-sm transition ${
                isActive
                  ? 'bg-white text-blue-800 font-semibold'
                  : 'text-blue-100 hover:bg-blue-700'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Logout */}
      <div className="px-5 py-5">
        <button
          onClick={handleLogout}
          className="w-full text-sm text-blue-200 hover:text-white hover:bg-blue-700 rounded-lg px-4 py-2 transition"
        >
          ออกจากระบบ
        </button>
      </div>
    </aside>
  );
}
