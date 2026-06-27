import { useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  BarChart3, ClipboardList, AlertTriangle, User, GraduationCap, Bus,
  CheckSquare, Plus, FileText, Key, Landmark, Building2, Home, Users,
  Activity, Ruler, TrendingUp, Package, Target, Map, Wrench, ChevronDown, X,
  ShieldAlert, ShieldCheck, MapPin, Route, Clock,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { isGradeTeacher, getGradeScope } from '../utils/authScope';
import { PAGE_TITLES } from '../constants/uiLabels';
import { motion } from 'motion/react';

// section: string = section heading (not a link)
// to + label + icon (lucide component) = nav link item

const DRIVER_NAV = [
  { section: 'ภาพรวม' },
  { to: '/driver',             icon: BarChart3,      label: PAGE_TITLES.DRIVER_DASHBOARD },
  { section: 'งานประจำวัน' },
  { to: '/driver/shift',       icon: Bus,            label: 'เลือกรถและเริ่มรอบ' },
  { to: '/driver/pickup-map',  icon: Map,            label: 'แผนที่จุดรับส่ง' },
  { to: '/driver/requests',    icon: ClipboardList,  label: 'คำขอรายชื่อ' },
  { to: '/driver/vehicle-registration', icon: GraduationCap, label: 'รายชื่อเด็กในรถ' },
  { to: '/driver/applications', icon: CheckSquare,   label: 'สถานะส่งตรวจรถ' },
  { to: '/driver/emergency',   icon: AlertTriangle,  label: 'แจ้งเหตุฉุกเฉิน' },
  { section: 'ข้อมูล' },
  { to: '/driver/profile',     icon: User,           label: 'ข้อมูลคนขับ' },
];

// Phase 8.2 — school main crossed 10 items after Phase 7.11/7.12; split
// into smaller cluster-groups and turn on collapsible so daily-use
// sections (ภาพรวม / นักเรียนและรถ / แผนที่และตำแหน่ง) stay above the fold.
const SCHOOL_NAV = [
  { section: 'ภาพรวม' },
  { to: '/school',               icon: BarChart3,     label: PAGE_TITLES.SCHOOL_DASHBOARD },
  { section: 'นักเรียนและรถรับส่ง' },
  { to: '/school/students',      icon: GraduationCap, label: 'ข้อมูลนักเรียน' },
  { to: '/school/vehicles',      icon: Bus,           label: 'รถรับส่ง' },
  { to: '/school/vehicle-verification', icon: CheckSquare, label: 'ส่งตรวจและรับรองรถ' },
  { to: '/school/bulk-vehicles', icon: Plus,          label: 'เพิ่มรถรับส่ง' },
  { section: 'แผนที่และตำแหน่ง' },
  { to: '/school/pickup-map',    icon: Map,           label: 'แผนที่จุดรับส่ง' },
  { to: '/school/live-vehicles', icon: Activity,      label: 'ตำแหน่งปัจจุบัน' },
  { section: 'คำขอและบัญชี' },
  { to: '/school/approvals',     icon: CheckSquare,   label: 'คำขอรายชื่อ' },
  { to: '/school/registration-review', icon: ClipboardList, label: 'ตรวจลงทะเบียนรถ' },
  { to: '/school/teacher-accounts', icon: Users,      label: 'บัญชีครูประจำสายชั้น' },
  { section: 'ติดตามและบันทึก' },
  { to: '/school/emergencies',   icon: AlertTriangle, label: 'เหตุฉุกเฉิน' },
  { to: '/school/audit-log',     icon: FileText,      label: 'ประวัติการแก้ไข' },
  { section: 'รายงาน' },
  { to: '/reports/daily',        icon: FileText,      label: 'รายงาน' },
];

// Phase 8.2 — light grouping, no collapse (9 items). Surface the existing
// /affiliation/schools route ("โรงเรียนในสังกัด") which was reachable but
// not linked from the sidebar.
const AFFILIATION_NAV = [
  { section: 'ภาพรวม' },
  { to: '/affiliation',             icon: BarChart3,     label: PAGE_TITLES.AFFILIATION_DASHBOARD },
  { section: 'ข้อมูลในสังกัด' },
  { to: '/affiliation/schools',     icon: Building2,     label: 'โรงเรียนในสังกัด' },
  { to: '/affiliation/students',    icon: GraduationCap, label: 'ข้อมูลนักเรียน' },
  { to: '/affiliation/vehicles',    icon: Bus,           label: 'รถรับส่ง' },
  // Phase 10.8UX-B-1 — folded the orphan "คำขอและบัญชี" section (single
  // item) into "ข้อมูลในสังกัด" so the sidebar doesn't carry a one-item
  // section header. Route + permission unchanged.
  { to: '/affiliation/accounts',    icon: Key,           label: 'เพิ่มโรงเรียนใหม่' },
  { section: 'คำขอและอนุมัติ' },
  { to: '/affiliation/transfer-requests', icon: Users,   label: 'คำขอโอนย้ายนักเรียน' },
  { to: '/affiliation/vehicle-requests',  icon: Wrench,  label: 'คำขอเกี่ยวกับรถ' },
  { section: 'แผนที่และตำแหน่ง' },
  { to: '/affiliation/live-vehicles', icon: Activity,    label: 'ตำแหน่งปัจจุบัน' },
  { to: '/affiliation/pickup-map',  icon: Map,           label: 'แผนที่จุดรับส่ง' },
  { section: 'ติดตามและบันทึก' },
  { to: '/affiliation/emergencies', icon: AlertTriangle, label: 'เหตุฉุกเฉิน' },
  { to: '/affiliation/audit-log',   icon: FileText,      label: 'ประวัติการแก้ไข' },
  { section: 'รายงาน' },
  { to: '/reports/daily',           icon: FileText,      label: 'รายงาน' },
];

// Phase 8.2 — split the previous broad "ข้อมูล" group (6 items) into
// "ข้อมูลพื้นฐาน" (read-only catalog) + "แผนที่และการกำกับติดตาม"
// (live + pickup map). Same items, clearer mental model.
const PROVINCE_NAV = [
  { section: 'ภาพรวม' },
  { to: '/province',              icon: BarChart3,     label: PAGE_TITLES.PROVINCE_DASHBOARD },
  { section: 'ข้อมูลพื้นฐาน' },
  { to: '/province/affiliations', icon: Landmark,      label: 'สังกัด' },
  { to: '/province/schools',      icon: Building2,     label: 'โรงเรียน' },
  { to: '/province/students',     icon: GraduationCap, label: 'ข้อมูลนักเรียน' },
  { to: '/province/vehicles',     icon: Bus,           label: 'รถรับส่ง' },
  { section: 'แผนที่และการกำกับติดตาม' },
  { to: '/province/live-vehicles', icon: Activity,     label: 'ตำแหน่งปัจจุบัน' },
  { to: '/province/pickup-map',   icon: Map,           label: 'แผนที่จุดรับส่ง' },
  { section: 'ติดตามและบันทึก' },
  { to: '/province/readiness',    icon: ShieldCheck,   label: 'ความพร้อมเปิดใช้งาน' },
  { to: '/admin/route-deviations', icon: Route,        label: 'การเบี่ยงเส้นทาง' },
  { to: '/province/emergencies',  icon: AlertTriangle, label: 'เหตุฉุกเฉิน' },
  { to: '/province/audit-log',    icon: FileText,      label: 'ประวัติการแก้ไข' },
  { section: 'รายงาน' },
  { to: '/reports/daily',         icon: FileText,      label: 'รายงาน' },
];

const TRANSPORT_NAV = [
  { section: 'ภาพรวม' },
  { to: '/transport',              icon: BarChart3,    label: 'ภาพรวมตรวจสภาพรถ' },
  { to: '/transport/pickup-map',   icon: Map,          label: 'แผนที่จุดรับส่ง' },
  { section: 'บันทึก' },
  { to: '/transport/verification', icon: CheckSquare,  label: 'ตรวจรับรองรถ' },
  { to: '/transport/inspections',  icon: ClipboardList, label: 'บันทึกตรวจสภาพ' },
];

// Phase 8.2 — the old "ข้อมูลจังหวัด" mixed read-only province views with
// management tools for school/affiliation/transport (per Phase 8.1
// finding #2). Split into a pure province "มุมมองจังหวัด" group and a
// dedicated "จัดการระบบ" group for cross-role admin tools, and merge
// the analytics/reports cluster into "รายงานและวิเคราะห์".
const ADMIN_NAV = [
  { section: 'ภาพรวม' },
  { to: '/admin',                 icon: Home,        label: 'ศูนย์ควบคุมระบบ' },
  { section: 'จัดการระบบ' },
  { to: '/admin/users',           icon: Users,       label: 'จัดการผู้ใช้งาน' },
  { to: '/school',                icon: Building2,   label: 'จัดการโรงเรียน' },
  { to: '/affiliation/accounts',  icon: Key,         label: 'เพิ่มโรงเรียนใหม่' },
  { to: '/transport',             icon: Wrench,      label: 'ตรวจสภาพรถ' },
  { section: 'ตรวจสอบและสนับสนุน' },
  { to: '/admin/readiness',       icon: ShieldCheck, label: 'ความพร้อมเปิดใช้งาน' },
  { to: '/admin/pickup-points',   icon: Map,         label: 'ตรวจสอบจุดรับส่ง' },
  { to: '/admin/live-vehicles',   icon: ShieldAlert, label: 'ตรวจสอบตำแหน่งรถ' },
  { to: '/admin/transfer-requests', icon: Users,     label: 'คำขอโอนย้ายนักเรียน' },
  { to: '/admin/vehicle-requests', icon: Wrench,     label: 'คำขอเกี่ยวกับรถ' },
  { to: '/admin/driver-integrity', icon: ShieldAlert, label: 'สุขภาพข้อมูลคนขับ' },
  { to: '/admin/geofences',       icon: MapPin,      label: 'จุดเตือนภัย (Geofences)' },
  { to: '/admin/route-deviations', icon: Route,      label: 'การเบี่ยงเส้นทาง' },
  { to: '/admin/audit-logs',      icon: FileText,    label: 'ประวัติการใช้งาน' },
  { to: '/admin/system-health',   icon: Activity,    label: 'สุขภาพระบบ' },
  { section: 'มุมมองจังหวัด' },
  { to: '/province',              icon: Map,         label: 'ภาพรวมจังหวัด' },
  { to: '/province/students',     icon: GraduationCap, label: 'ข้อมูลนักเรียน' },
  { to: '/province/vehicles',     icon: Bus,         label: 'รถรับส่ง' },
  { section: 'รายงานและวิเคราะห์' },
  { to: '/admin/measurement',     icon: Ruler,       label: 'กรอบวัดผลระบบ' },
  { to: '/admin/research',        icon: TrendingUp,  label: 'เปรียบเทียบ Baseline' },
  { to: '/admin/research-export', icon: Package,     label: 'ส่งออกข้อมูลวิจัย' },
  { to: '/admin/evaluation',      icon: Target,      label: 'ประเมินผลแยก Role' },
  { to: '/admin/executive',       icon: BarChart3,   label: 'สรุปผู้บริหาร' },
  { to: '/reports/daily',         icon: FileText,    label: 'รายงาน' },
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

// Phase 8.2 — collapsible groups for roles that crossed the 10-item
// threshold (admin always; school main after 7.11/7.12 brought it to 11
// items). School grade teachers see only ~8 filtered items, so they keep
// static headers so the active section is always visible.
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
  // Phase 8.2 — drop section headers whose items were all filtered out
  // (e.g. teacher-blocked routes). Keeps the grade-teacher sidebar tight.
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

export default function Sidebar({ onClose }) {
  const { user, features, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const groups = useMemo(() => buildGroups(navItemsForUser(user, features)), [user?.role, user?.grade_scope, user?.gradeScope, features]);
  const teacherGrade = getGradeScope(user);
  const useCollapsible = isCollapsibleForUser(user);

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
    <aside className="w-full md:w-56 shrink-0 h-full bg-brand-800 text-white flex flex-col">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-brand-700 shrink-0 flex items-start justify-between">
        <div>
          <p className="font-semibold text-sm leading-tight">ระบบรถรับส่งนักเรียน</p>
          <p className="text-brand-200 text-xs mt-0.5">จังหวัดลำปาง</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden -mr-2 -mt-1 inline-flex items-center justify-center w-10 h-10 rounded-md hover:bg-brand-700 active:bg-brand-600 transition"
            aria-label="ปิดเมนู"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        )}
      </div>

      {/* User info */}
      <div className="px-5 py-3 border-b border-brand-700 shrink-0">
        <p className="text-xs text-brand-200">เข้าสู่ระบบในฐานะ</p>
        <p className="font-semibold text-sm truncate">{user?.display_name || user?.username}</p>
        {teacherGrade && (
          <p className="text-[11px] text-brand-100 mt-0.5">
            ครูประจำสายชั้น · ขอบเขต {teacherGrade}
          </p>
        )}
      </div>

      {/* Navigation — collapsible only when isCollapsibleForUser, flat otherwise */}
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
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-[10px] font-semibold uppercase tracking-wider text-brand-300 hover:text-brand-100 hover:bg-brand-700/40 active:bg-brand-700/60 transition ${gi === 0 ? 'mt-0' : 'mt-2'}`}
                >
                  <span>{group.section}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                </button>
              )}
              {hasHeader && !sectionCollapsible && (
                <p className={`px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-brand-300 ${gi === 0 ? 'pt-1' : 'pt-4'}`}>
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
                        `relative flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm transition mb-0.5 min-h-[40px] ${
                          isActive ? 'text-brand-800 font-semibold' : 'text-brand-50 hover:bg-brand-700 active:bg-brand-600'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <motion.span
                              layoutId="sidebar-active"
                              className="absolute inset-0 rounded-lg bg-white"
                              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                            />
                          )}
                          {item.icon && <item.icon className="w-4 h-4 shrink-0 relative z-10" strokeWidth={2} />}
                          <span className="truncate relative z-10">{item.label}</span>
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

      {/* Logout */}
      <div className="px-5 py-3 border-t border-brand-700 shrink-0">
        <button onClick={handleLogout}
          className="w-full text-sm text-brand-100 hover:text-white hover:bg-brand-700 active:bg-brand-600 rounded-lg px-4 py-2.5 min-h-[40px] transition">
          ออกจากระบบ
        </button>
      </div>

      <div className="px-5 pb-3 shrink-0">
        <div className="border-t border-blue-700/40 pt-2">
          <p className="text-[11px] text-blue-300/80">Copyright © 2026 Natthakarn S. | v2.0</p>
        </div>
      </div>
    </aside>
  );
}
