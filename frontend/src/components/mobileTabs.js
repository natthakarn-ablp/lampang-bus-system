import { Home, GraduationCap, CheckSquare, FileText, Building2, Activity } from 'lucide-react';

// Mobile bottom-nav tab sets, shared by the role layouts and ReportsLayout so
// the bar stays on screen after tapping รายงาน (QA ui-visual-05).

// Phase 10.8UX-B-2B — mobile bottom nav tabs for school role.
// Term 2: "เช็กชื่อ" (teacher check-in) replaces the live-location tab — the
// teacher's daily task belongs under the thumb; live location stays in the
// sidebar. All 4 destinations work for full school and grade-teacher accounts.
// Other write actions like
// "ยืนยันแทนคนขับ" / "จัดการรถ" stay in the dashboard action row where the
// existing teacher-hiding logic already lives.
export const SCHOOL_TABS = [
  { to: '/school',                end: true,  icon: Home,          label: 'หน้าแรก' },
  { to: '/school/students',       end: false, icon: GraduationCap, label: 'นักเรียน' },
  { to: '/school/teacher-check',  end: false, icon: CheckSquare,   label: 'เช็กชื่อ' },
  { to: '/reports/daily',         end: false, icon: FileText,      label: 'รายงาน' },
];

// Phase 10.8UX-B-2B — mobile bottom nav tabs for affiliation role.
export const AFFILIATION_TABS = [
  { to: '/affiliation',                 end: true,  icon: Home,      label: 'หน้าแรก' },
  { to: '/affiliation/schools',         end: false, icon: Building2, label: 'โรงเรียน' },
  { to: '/affiliation/live-vehicles',   end: false, icon: Activity,  label: 'ตำแหน่ง' },
  { to: '/reports/daily',               end: false, icon: FileText,  label: 'รายงาน' },
];

export const ROLE_TABS = { school: SCHOOL_TABS, affiliation: AFFILIATION_TABS };
