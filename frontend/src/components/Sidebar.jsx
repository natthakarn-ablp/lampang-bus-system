import { useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  BarChart3, ClipboardList, AlertTriangle, User, GraduationCap, Bus,
  CheckSquare, Plus, FileText, Key, Landmark, Building2, Home, Users,
  Activity, Ruler, TrendingUp, Package, Target, Map, Wrench, ChevronDown, X,
  ShieldAlert, ShieldCheck, MapPin, Route, Calendar, LogOut,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { isGradeTeacher, getGradeScope } from '../utils/authScope';
import { PAGE_TITLES } from '../constants/uiLabels';

// section: string = section heading (not a link)
// to + label + icon (lucide component) = nav link item
//
// Section vocabulary is shared across every role (Phase 2 of the redesign):
//   ภาพรวม               — where the role lands; "what is today like"
//   งานดำเนินการ          — things awaiting a decision or an action
//   ข้อมูลหลัก            — the records the role owns / reads
//   ตรวจสอบและสนับสนุน    — oversight, maps, integrity, audit
//   รายงานและวิจัย        — reporting and analysis
//   ตั้งค่าระบบ           — configuration
// Only the GROUPING changed; every `to` from the previous menu is still here.

const DRIVER_NAV = [
  { section: 'ภาพรวม' },
  { to: '/driver',             icon: BarChart3,      label: PAGE_TITLES.DRIVER_DASHBOARD },
  { section: 'งานดำเนินการ' },
  { to: '/driver/shift',       icon: Bus,            label: 'เลือกรถและเริ่มรอบ' },
  { to: '/driver/pickup-map',  icon: Map,            label: 'แผนที่จุดรับส่ง' },
  { to: '/driver/requests',    icon: ClipboardList,  label: 'คำขอรายชื่อ' },
  { to: '/driver/vehicle-registration', icon: GraduationCap, label: 'รายชื่อเด็กในรถ' },
  { to: '/driver/applications', icon: CheckSquare,   label: 'สถานะส่งตรวจรถ' },
  { to: '/driver/emergency',   icon: AlertTriangle,  label: 'แจ้งเหตุฉุกเฉิน' },
  { section: 'ข้อมูลหลัก' },
  { to: '/driver/profile',     icon: User,           label: 'ข้อมูลคนขับ' },
];

const SCHOOL_NAV = [
  { section: 'ภาพรวม' },
  { to: '/school',               icon: BarChart3,     label: PAGE_TITLES.SCHOOL_DASHBOARD },
  { section: 'งานดำเนินการ' },
  { to: '/school/approvals',     icon: CheckSquare,   label: 'คำขอรายชื่อ' },
  { to: '/school/registration-review', icon: ClipboardList, label: 'ตรวจลงทะเบียนรถ' },
  { to: '/school/vehicle-verification', icon: CheckSquare, label: 'ส่งตรวจและรับรองรถ' },
  { section: 'ข้อมูลหลัก' },
  { to: '/school/students',      icon: GraduationCap, label: 'ข้อมูลนักเรียน' },
  { to: '/school/vehicles',      icon: Bus,           label: 'รถรับส่ง' },
  { to: '/school/bulk-vehicles', icon: Plus,          label: 'เพิ่มรถรับส่ง' },
  { to: '/school/teacher-accounts', icon: Users,      label: 'บัญชีครูประจำสายชั้น' },
  { section: 'ตรวจสอบและสนับสนุน' },
  { to: '/school/pickup-map',    icon: Map,           label: 'แผนที่จุดรับส่ง' },
  { to: '/school/live-vehicles', icon: Activity,      label: 'ตำแหน่งปัจจุบัน' },
  { to: '/school/emergencies',   icon: AlertTriangle, label: 'เหตุฉุกเฉิน' },
  { to: '/school/audit-log',     icon: FileText,      label: 'ประวัติการแก้ไข' },
  { section: 'รายงานและวิจัย' },
  { to: '/reports/daily',        icon: FileText,      label: 'รายงาน' },
];

const AFFILIATION_NAV = [
  { section: 'ภาพรวม' },
  { to: '/affiliation',             icon: BarChart3,     label: PAGE_TITLES.AFFILIATION_DASHBOARD },
  { section: 'งานดำเนินการ' },
  { to: '/affiliation/transfer-requests', icon: Users,   label: 'คำขอโอนย้ายนักเรียน' },
  { to: '/affiliation/vehicle-requests',  icon: Wrench,  label: 'คำขอเกี่ยวกับรถ' },
  { section: 'ข้อมูลหลัก' },
  { to: '/affiliation/schools',     icon: Building2,     label: 'โรงเรียนในสังกัด' },
  { to: '/affiliation/students',    icon: GraduationCap, label: 'ข้อมูลนักเรียน' },
  { to: '/affiliation/vehicles',    icon: Bus,           label: 'รถรับส่ง' },
  { to: '/affiliation/accounts',    icon: Key,           label: 'เพิ่มโรงเรียนใหม่' },
  { section: 'ตรวจสอบและสนับสนุน' },
  { to: '/affiliation/live-vehicles', icon: Activity,    label: 'ตำแหน่งปัจจุบัน' },
  { to: '/affiliation/pickup-map',  icon: Map,           label: 'แผนที่จุดรับส่ง' },
  { to: '/affiliation/emergencies', icon: AlertTriangle, label: 'เหตุฉุกเฉิน' },
  { to: '/affiliation/audit-log',   icon: FileText,      label: 'ประวัติการแก้ไข' },
  { section: 'รายงานและวิจัย' },
  { to: '/reports/daily',           icon: FileText,      label: 'รายงาน' },
];

const PROVINCE_NAV = [
  { section: 'ภาพรวม' },
  { to: '/province',              icon: BarChart3,     label: PAGE_TITLES.PROVINCE_DASHBOARD },
  { section: 'ข้อมูลหลัก' },
  { to: '/province/affiliations', icon: Landmark,      label: 'สังกัด' },
  { to: '/province/schools',      icon: Building2,     label: 'โรงเรียน' },
  { to: '/province/students',     icon: GraduationCap, label: 'ข้อมูลนักเรียน' },
  { to: '/province/vehicles',     icon: Bus,           label: 'รถรับส่ง' },
  { section: 'ตรวจสอบและสนับสนุน' },
  { to: '/province/live-vehicles', icon: Activity,     label: 'ตำแหน่งปัจจุบัน' },
  { to: '/province/pickup-map',   icon: Map,           label: 'แผนที่จุดรับส่ง' },
  { to: '/province/readiness',    icon: ShieldCheck,   label: 'ความพร้อมเปิดใช้งาน' },
  { to: '/admin/route-deviations', icon: Route,        label: 'การเบี่ยงเส้นทาง' },
  { to: '/province/emergencies',  icon: AlertTriangle, label: 'เหตุฉุกเฉิน' },
  { to: '/province/audit-log',    icon: FileText,      label: 'ประวัติการแก้ไข' },
  { section: 'รายงานและวิจัย' },
  { to: '/reports/daily',         icon: FileText,      label: 'รายงาน' },
];

const TRANSPORT_NAV = [
  { section: 'ภาพรวม' },
  { to: '/transport',              icon: BarChart3,    label: 'ภาพรวมตรวจสภาพรถ' },
  { section: 'งานดำเนินการ' },
  { to: '/transport/verification', icon: CheckSquare,  label: 'ตรวจรับรองรถ' },
  { to: '/transport/inspections',  icon: ClipboardList, label: 'บันทึกตรวจสภาพ' },
  { section: 'ตรวจสอบและสนับสนุน' },
  { to: '/transport/pickup-map',   icon: Map,          label: 'แผนที่จุดรับส่ง' },
];

const ADMIN_NAV = [
  { section: 'ภาพรวม' },
  { to: '/admin',                 icon: Home,        label: 'ศูนย์ควบคุมระบบ' },
  { section: 'งานดำเนินการ' },
  { to: '/admin/transfer-requests', icon: Users,     label: 'คำขอโอนย้ายนักเรียน' },
  { to: '/admin/vehicle-requests', icon: Wrench,     label: 'คำขอเกี่ยวกับรถ' },
  { section: 'ข้อมูลหลัก' },
  { to: '/admin/users',           icon: Users,       label: 'จัดการผู้ใช้งาน' },
  { to: '/school',                icon: Building2,   label: 'จัดการโรงเรียน' },
  { to: '/affiliation/accounts',  icon: Key,         label: 'เพิ่มโรงเรียนใหม่' },
  { to: '/province',              icon: Map,         label: 'ภาพรวมจังหวัด' },
  { to: '/province/students',     icon: GraduationCap, label: 'ข้อมูลนักเรียน' },
  { to: '/province/vehicles',     icon: Bus,         label: 'รถรับส่ง' },
  { section: 'ตรวจสอบและสนับสนุน' },
  { to: '/admin/readiness',       icon: ShieldCheck, label: 'ความพร้อมเปิดใช้งาน' },
  { to: '/admin/pickup-points',   icon: MapPin,      label: 'ตรวจสอบจุดรับส่ง' },
  { to: '/admin/live-vehicles',   icon: ShieldAlert, label: 'ตรวจสอบตำแหน่งรถ' },
  { to: '/admin/driver-integrity', icon: ShieldAlert, label: 'สุขภาพข้อมูลคนขับ' },
  { to: '/admin/geofences',       icon: MapPin,      label: 'จุดเตือนภัย (Geofences)' },
  { to: '/admin/route-deviations', icon: Route,      label: 'การเบี่ยงเส้นทาง' },
  { to: '/admin/audit-logs',      icon: FileText,    label: 'ประวัติการใช้งาน' },
  { to: '/admin/system-health',   icon: Activity,    label: 'สุขภาพระบบ' },
  { to: '/transport',             icon: Wrench,      label: 'ตรวจสภาพรถ' },
  { section: 'รายงานและวิจัย' },
  { to: '/admin/measurement',     icon: Ruler,       label: 'กรอบวัดผลระบบ' },
  { to: '/admin/research',        icon: TrendingUp,  label: 'เปรียบเทียบ Baseline' },
  { to: '/admin/research-export', icon: Package,     label: 'ส่งออกข้อมูลวิจัย' },
  { to: '/admin/evaluation',      icon: Target,      label: 'ประเมินผลแยก Role' },
  { to: '/admin/executive',       icon: BarChart3,   label: 'สรุปผู้บริหาร' },
  { to: '/reports/daily',         icon: FileText,    label: 'รายงาน' },
  { section: 'ตั้งค่าระบบ' },
  { to: '/admin/term-settings',   icon: Calendar,    label: 'ภาคเรียนปัจจุบัน' },
];

const NAV_MAP = { driver: DRIVER_NAV, school: SCHOOL_NAV, affiliation: AFFILIATION_NAV, province: PROVINCE_NAV, transport: TRANSPORT_NAV, admin: ADMIN_NAV };

/**
 * Phase 7.11.4 — for a homeroom-teacher sub-account
 * (role='school' + grade_scope set), drop write-only / admin-only
 * school routes from the sidebar so the teacher only sees pages
 * that work for them. Backend still 403s these paths.
 */
const TEACHER_BLOCKED_PATHS = new Set([
  '/school/audit-log',
  '/school/bulk-vehicles',
  '/school/teacher-accounts',
]);

function navItemsForUser(user, features) {
  const base = NAV_MAP[user?.role] || [];
  // Phase 11A audit fix M7: hide sidebar links for flag-gated routes when
  // the corresponding feature flag is off, so users don't click into a 404.
  const FLAG_GATED = {
    '/admin/geofences': 'geofence',
    '/admin/route-deviations': 'routeDeviation',
    // "เลือกรถและเริ่มรอบ" is only meaningful when shift-selection is enabled.
    // When the flag is off the system auto-resolves the driver's vehicle and a
    // shift is never required, so the page just shows a confusing INELIGIBLE
    // state — hide it from the menu until the flag is on.
    '/driver/shift': 'driverShiftSelection',
    '/driver/vehicle-registration': 'driverRegistration',
    '/driver/applications': 'driverRegistration',
    '/school/registration-review': 'driverRegistration',
  };
  const filtered = base.filter(item => {
    if (!item.to) return true;
    const flag = FLAG_GATED[item.to];
    if (!flag) return true;
    return features ? !!features[flag] : false;
  });
  // When the consolidated "รายชื่อเด็กในรถ" (driver registration) is ON, hide the
  // older overlapping "คำขอรายชื่อ" so an elderly driver sees ONE place, not two
  // similar buttons. Reversible: flipping the flag off restores the old menu.
  const hidden = (features && features.driverRegistration) ? new Set(['/driver/requests']) : new Set();
  const deduped = filtered.filter(item => !item.to || !hidden.has(item.to));
  if (!isGradeTeacher(user)) return deduped;
  return deduped.filter(item => item.section || !TEACHER_BLOCKED_PATHS.has(item.to));
}

// Collapsible groups for roles whose menu crossed the 10-item threshold.
// Grade teachers see ~8 filtered items, so they keep static headers and the
// active section is always visible.
function isCollapsibleForUser(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'school' && !isGradeTeacher(user)) return true;
  return false;
}

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
  // Drop section headers whose items were all filtered out (e.g.
  // teacher-blocked routes). Keeps the grade-teacher sidebar tight.
  return groups.filter(g => g.items.length > 0);
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

export default function Sidebar({ onClose, collapsed = false }) {
  const { user, features, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const groups = useMemo(() => buildGroups(navItemsForUser(user, features)), [user?.role, user?.grade_scope, user?.gradeScope, features]);
  const teacherGrade = getGradeScope(user);
  // In rail mode every group is flattened to icons, so collapsing is moot.
  const useCollapsible = isCollapsibleForUser(user) && !collapsed;

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
    <aside
      className={`h-full shrink-0 bg-navy-700 text-white flex flex-col ${
        collapsed ? 'w-full md:w-sidebar-rail' : 'w-full md:w-sidebar'
      }`}
      aria-label="เมนูหลัก"
    >
      {/* Brand */}
      <div className={`shrink-0 border-b border-navy-600/70 flex items-start justify-between ${collapsed ? 'px-0 py-4 justify-center' : 'px-5 py-4'}`}>
        {collapsed ? (
          <span className="w-10 h-10 rounded-xl bg-white/10 inline-flex items-center justify-center" title="ระบบรถรับส่งนักเรียน จังหวัดลำปาง">
            <Bus className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">ระบบรถรับส่งนักเรียน จังหวัดลำปาง</span>
          </span>
        ) : (
          <>
            <div className="min-w-0">
              <p className="font-semibold text-sm leading-tight">ระบบรถรับส่งนักเรียน</p>
              <p className="text-navy-200 text-xs mt-0.5">จังหวัดลำปาง</p>
              {teacherGrade && (
                <p className="text-[11px] text-navy-100 mt-1">
                  ครูประจำสายชั้น · ขอบเขต {teacherGrade}
                </p>
              )}
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="focus-ring-inverse md:hidden -mr-2 -mt-1 inline-flex items-center justify-center w-11 h-11 rounded-lg hover:bg-navy-600 active:bg-navy-500 transition"
                aria-label="ปิดเมนู"
              >
                <X className="w-5 h-5" strokeWidth={2} />
              </button>
            )}
          </>
        )}
      </div>

      {/* Navigation — the only scroll container in the shell besides <main> */}
      <nav className={`flex-1 overflow-y-auto overscroll-contain py-3 ${collapsed ? 'px-2' : 'px-3'}`}>
        {groups.map((group, gi) => {
          const key = group.section || `__g${gi}`;
          const hasHeader = !!group.section;
          const sectionCollapsible = useCollapsible && hasHeader;
          const isOpen = sectionCollapsible ? !!openSections[key] : true;
          const panelId = `sidebar-section-${gi}`;
          return (
            <div key={key}>
              {/* Rail mode: a hairline stands in for the section header */}
              {collapsed && gi > 0 && <div className="my-2 mx-2 border-t border-navy-600/60" />}

              {!collapsed && hasHeader && sectionCollapsible && (
                <button
                  type="button"
                  onClick={() => toggleSection(key)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className={`focus-ring-inverse w-full flex items-center justify-between px-3 py-2 rounded-md text-[11px] font-semibold tracking-wide text-navy-200 hover:text-white hover:bg-navy-600/50 active:bg-navy-600 transition ${gi === 0 ? 'mt-0' : 'mt-2'}`}
                >
                  <span>{group.section}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                </button>
              )}
              {!collapsed && hasHeader && !sectionCollapsible && (
                <p className={`px-3 pb-1 text-[11px] font-semibold tracking-wide text-navy-200 ${gi === 0 ? 'pt-1' : 'pt-4'}`}>
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
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        `focus-ring-inverse group relative flex items-center rounded-lg text-sm transition mb-0.5 min-h-[44px] ${
                          collapsed ? 'justify-center px-0' : 'gap-2.5 pl-4 pr-3'
                        } ${
                          isActive
                            // Active = tinted panel + a 3px left accent, not a
                            // full white slab. Reads clearly against navy while
                            // keeping the rail visually calm.
                            ? 'bg-white/12 text-white font-semibold'
                            : 'text-navy-50 hover:bg-white/8 hover:text-white active:bg-white/15'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <span
                              className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-white ${collapsed ? 'left-0' : ''}`}
                              aria-hidden="true"
                            />
                          )}
                          {item.icon && <item.icon className="w-[18px] h-[18px] shrink-0" strokeWidth={isActive ? 2.4 : 2} aria-hidden="true" />}
                          {collapsed ? (
                            <span className="sr-only">{item.label}</span>
                          ) : (
                            <span className="truncate">{item.label}</span>
                          )}
                        </>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Logout — fixed position at the bottom, never scrolls away */}
      <div className={`shrink-0 border-t border-navy-600/70 ${collapsed ? 'px-2 py-3' : 'px-3 py-3'}`}>
        <button
          onClick={handleLogout}
          title={collapsed ? 'ออกจากระบบ' : undefined}
          className={`focus-ring-inverse w-full inline-flex items-center rounded-lg text-sm text-navy-50 hover:bg-white/10 hover:text-white active:bg-white/15 min-h-[44px] transition ${
            collapsed ? 'justify-center px-0' : 'gap-2.5 px-4'
          }`}
        >
          <LogOut className="w-[18px] h-[18px] shrink-0" strokeWidth={2} aria-hidden="true" />
          {collapsed ? <span className="sr-only">ออกจากระบบ</span> : 'ออกจากระบบ'}
        </button>
      </div>

      {!collapsed && (
        <div className="px-5 pb-3 shrink-0">
          <p className="text-[11px] text-navy-300">Copyright © 2026 Natthakarn S. | v2.0</p>
        </div>
      )}
    </aside>
  );
}
