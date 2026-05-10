import { useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  BarChart3, ClipboardList, AlertTriangle, User, GraduationCap, Bus,
  CheckSquare, Plus, FileText, Key, Landmark, Building2, Home, Users,
  Activity, Ruler, TrendingUp, Package, Target, Map, Wrench, ChevronDown, X,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { PAGE_TITLES } from '../constants/uiLabels';

// section: string = section heading (not a link)
// to + label + icon (lucide component) = nav link item

const DRIVER_NAV = [
  { section: 'ภาพรวม' },
  { to: '/driver',             icon: BarChart3,      label: PAGE_TITLES.DRIVER_DASHBOARD },
  { section: 'งานประจำวัน' },
  { to: '/driver/pickup-map',  icon: Map,            label: 'แผนที่จุดรับส่ง' },
  { to: '/driver/requests',    icon: ClipboardList,  label: 'คำขอรายชื่อ' },
  { to: '/driver/emergency',   icon: AlertTriangle,  label: 'แจ้งเหตุฉุกเฉิน' },
  { section: 'ข้อมูล' },
  { to: '/driver/profile',     icon: User,           label: 'ข้อมูลคนขับ' },
];

const SCHOOL_NAV = [
  { section: 'ภาพรวม' },
  { to: '/school',               icon: BarChart3,     label: PAGE_TITLES.SCHOOL_DASHBOARD },
  { section: 'ข้อมูลหลัก' },
  { to: '/school/students',      icon: GraduationCap, label: 'ข้อมูลนักเรียน' },
  { to: '/school/vehicles',      icon: Bus,           label: 'รถรับส่ง' },
  { to: '/school/pickup-map',    icon: Map,           label: 'แผนที่จุดรับส่ง' },
  { to: '/school/live-vehicles', icon: Activity,      label: 'ตำแหน่งรถสด' },
  { to: '/school/approvals',     icon: CheckSquare,   label: 'คำขอรายชื่อ' },
  { to: '/school/bulk-vehicles', icon: Plus,          label: 'เพิ่มรถรับส่ง' },
  { section: 'ติดตามและบันทึก' },
  { to: '/school/emergencies',   icon: AlertTriangle, label: 'เหตุฉุกเฉิน' },
  { to: '/school/audit-log',     icon: FileText,      label: 'ประวัติการแก้ไข' },
  { section: 'รายงาน' },
  { to: '/reports/daily',        icon: FileText,      label: 'รายงาน' },
];

const AFFILIATION_NAV = [
  { section: 'ภาพรวม' },
  { to: '/affiliation',             icon: BarChart3,     label: PAGE_TITLES.AFFILIATION_DASHBOARD },
  { section: 'ข้อมูล' },
  { to: '/affiliation/students',    icon: GraduationCap, label: 'ข้อมูลนักเรียน' },
  { to: '/affiliation/vehicles',    icon: Bus,           label: 'รถรับส่ง' },
  { section: 'จัดการ' },
  { to: '/affiliation/accounts',    icon: Key,           label: 'จัดการบัญชีโรงเรียน' },
  { section: 'ติดตามและบันทึก' },
  { to: '/affiliation/emergencies', icon: AlertTriangle, label: 'เหตุฉุกเฉิน' },
  { to: '/affiliation/audit-log',   icon: FileText,      label: 'ประวัติการแก้ไข' },
  { section: 'รายงาน' },
  { to: '/reports/daily',           icon: FileText,      label: 'รายงาน' },
];

const PROVINCE_NAV = [
  { section: 'ภาพรวม' },
  { to: '/province',              icon: BarChart3,     label: PAGE_TITLES.PROVINCE_DASHBOARD },
  { section: 'ข้อมูล' },
  { to: '/province/affiliations', icon: Landmark,      label: 'สังกัด' },
  { to: '/province/schools',      icon: Building2,     label: 'โรงเรียน' },
  { to: '/province/students',     icon: GraduationCap, label: 'ข้อมูลนักเรียน' },
  { to: '/province/vehicles',     icon: Bus,           label: 'รถรับส่ง' },
  { section: 'ติดตาม' },
  { to: '/province/emergencies',  icon: AlertTriangle, label: 'เหตุฉุกเฉิน' },
  { to: '/province/audit-log',    icon: FileText,      label: 'ประวัติการแก้ไข' },
  { section: 'รายงาน' },
  { to: '/reports/daily',         icon: FileText,      label: 'รายงาน' },
];

const TRANSPORT_NAV = [
  { section: 'ภาพรวม' },
  { to: '/transport',              icon: BarChart3,    label: 'ภาพรวมตรวจสภาพรถ' },
  { section: 'บันทึก' },
  { to: '/transport/inspections',  icon: ClipboardList, label: 'บันทึกตรวจสภาพ' },
];

const ADMIN_NAV = [
  { section: 'ระบบ' },
  { to: '/admin',                 icon: Home,        label: 'ศูนย์ควบคุมระบบ' },
  { to: '/admin/users',           icon: Users,       label: 'จัดการผู้ใช้งาน' },
  { to: '/admin/pickup-points',   icon: Map,         label: 'ตรวจสอบจุดรับส่ง' },
  { to: '/admin/audit-logs',      icon: FileText,    label: 'ประวัติการใช้งาน' },
  { to: '/admin/system-health',   icon: Activity,    label: 'สุขภาพระบบ' },
  { section: 'การวิจัย' },
  { to: '/admin/measurement',     icon: Ruler,       label: 'กรอบวัดผลระบบ' },
  { to: '/admin/research',        icon: TrendingUp,  label: 'เปรียบ Baseline' },
  { to: '/admin/research-export', icon: Package,     label: 'ส่งออกข้อมูลวิจัย' },
  { to: '/admin/evaluation',      icon: Target,      label: 'ประเมินผลแยก Role' },
  { to: '/admin/executive',       icon: BarChart3,   label: 'สรุปผู้บริหาร' },
  { section: 'ข้อมูลจังหวัด' },
  { to: '/province',              icon: Map,         label: 'ภาพรวมจังหวัด' },
  { to: '/province/students',     icon: GraduationCap, label: 'ข้อมูลนักเรียน' },
  { to: '/province/vehicles',     icon: Bus,         label: 'รถรับส่ง' },
  { to: '/reports/daily',         icon: FileText,    label: 'รายงาน' },
  { to: '/school',                icon: Building2,   label: 'จัดการโรงเรียน' },
  { to: '/affiliation/accounts',  icon: Key,         label: 'จัดการบัญชีโรงเรียน' },
  { to: '/transport',             icon: Wrench,      label: 'ตรวจสภาพรถ' },
];

const NAV_MAP = { driver: DRIVER_NAV, school: SCHOOL_NAV, affiliation: AFFILIATION_NAV, province: PROVINCE_NAV, transport: TRANSPORT_NAV, admin: ADMIN_NAV };

// Roles whose sidebar uses collapsible section groups.
// Other roles get a flat list with static section headers.
const COLLAPSIBLE_ROLES = new Set(['admin']);

function buildGroups(items) {
  const groups = [];
  let current = null;
  for (const item of items) {
    if (item.section) {
      current = { section: item.section, items: [] };
      groups.push(current);
    } else {
      if (!current) {
        current = { section: null, items: [] };
        groups.push(current);
      }
      current.items.push(item);
    }
  }
  return groups;
}

function isItemActive(toPath, pathname) {
  if (toPath.split('/').length === 2) return pathname === toPath;
  return pathname === toPath || pathname.startsWith(toPath + '/');
}

const STORAGE_KEY = 'sidebar:openSections';

function readStoredSections() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export default function Sidebar({ onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const groups = useMemo(() => buildGroups(NAV_MAP[user?.role] || []), [user?.role]);
  const useCollapsible = COLLAPSIBLE_ROLES.has(user?.role);

  const activeGroupKey = useMemo(() => {
    if (!useCollapsible) return null;
    const idx = groups.findIndex(g => g.items.some(it => isItemActive(it.to, pathname)));
    return idx >= 0 ? (groups[idx].section || `__g${idx}`) : null;
  }, [groups, pathname, useCollapsible]);

  const [openSections, setOpenSections] = useState(() => {
    if (!useCollapsible) return {};
    const stored = readStoredSections();
    if (activeGroupKey) stored[activeGroupKey] = true;
    return stored;
  });

  useEffect(() => {
    if (!useCollapsible) return;
    if (activeGroupKey) {
      setOpenSections(prev => (prev[activeGroupKey] ? prev : { ...prev, [activeGroupKey]: true }));
    }
  }, [activeGroupKey, useCollapsible]);

  useEffect(() => {
    if (!useCollapsible) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(openSections));
    } catch { /* ignore quota / privacy-mode errors */ }
  }, [openSections, useCollapsible]);

  function toggleSection(key) {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <aside className="w-64 md:w-56 shrink-0 h-full bg-blue-800 text-white flex flex-col">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-blue-700 shrink-0 flex items-start justify-between">
        <div>
          <p className="font-semibold text-sm leading-tight">ระบบรถรับส่งนักเรียน</p>
          <p className="text-blue-300 text-xs mt-0.5">จังหวัดลำปาง</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="md:hidden p-1 -mr-1 -mt-1 rounded-md hover:bg-blue-700 transition" aria-label="ปิดเมนู">
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        )}
      </div>

      {/* User info */}
      <div className="px-5 py-3 border-b border-blue-700 shrink-0">
        <p className="text-xs text-blue-300">เข้าสู่ระบบในฐานะ</p>
        <p className="font-semibold text-sm truncate">{user?.display_name || user?.username}</p>
      </div>

      {/* Navigation — collapsible only for COLLAPSIBLE_ROLES, flat otherwise */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {groups.map((group, gi) => {
          const key = group.section || `__g${gi}`;
          const hasHeader = !!group.section;
          const sectionCollapsible = useCollapsible && hasHeader;
          const isOpen = sectionCollapsible ? !!openSections[key] : true;
          const panelId = `sidebar-section-${gi}`;
          return (
            <div key={key}>
              {hasHeader && sectionCollapsible && (
                <button
                  type="button"
                  onClick={() => toggleSection(key)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className={`w-full flex items-center justify-between px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-blue-400 hover:text-blue-200 transition ${gi === 0 ? 'pt-1' : 'pt-4'}`}
                >
                  <span>{group.section}</span>
                  <ChevronDown
                    className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                </button>
              )}
              {hasHeader && !sectionCollapsible && (
                <p className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-blue-400 ${gi === 0 ? 'pt-1' : 'pt-4'}`}>
                  {group.section}
                </p>
              )}
              <div
                id={panelId}
                className={
                  sectionCollapsible
                    ? `grid transition-all duration-200 ease-in-out ${isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`
                    : ''
                }
                aria-hidden={sectionCollapsible ? !isOpen : undefined}
              >
                <div className={sectionCollapsible ? 'overflow-hidden min-h-0' : ''}>
                  {group.items.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to.split('/').length === 2}
                      tabIndex={isOpen ? 0 : -1}
                      className={({ isActive }) =>
                        `flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition mb-0.5 ${
                          isActive ? 'bg-white text-blue-800 font-semibold' : 'text-blue-100 hover:bg-blue-700'
                        }`
                      }
                    >
                      {item.icon && <item.icon className="w-4 h-4 shrink-0" strokeWidth={2} />}
                      <span>{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-5 py-4 border-t border-blue-700 shrink-0">
        <button onClick={handleLogout}
          className="w-full text-sm text-blue-200 hover:text-white hover:bg-blue-700 rounded-lg px-4 py-2 transition">
          ออกจากระบบ
        </button>
      </div>

      <div className="px-5 pb-3 shrink-0">
        <div className="border-t border-blue-700/40 pt-2">
          <p className="text-[11px] text-blue-300/80">Copyright © 2026 Natthakarn S. | v1.0</p>
        </div>
      </div>
    </aside>
  );
}
