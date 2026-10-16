import { NavLink } from 'react-router-dom';
import { Bus, GraduationCap, CheckSquare } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { isGradeTeacher } from '../utils/authScope';

// One set of destinations shared by setup pages and the daily task. These are
// navigation links, not completion indicators: no inferred setup state.
export default function SchoolWorkflowNav({ current }) {
  const { user } = useAuth();
  const teacher = isGradeTeacher(user);
  const steps = [
    { key: 'vehicles', to: '/school/vehicles', icon: Bus, label: 'รถรับส่ง' },
    { key: 'students', to: '/school/students', icon: GraduationCap, label: 'นักเรียน' },
    { key: 'attendance', to: '/school/teacher-check', icon: CheckSquare, label: 'เช็กชื่อวันนี้' },
  ];
  return (
    <nav aria-label="งานรถรับส่งของโรงเรียน" className="mb-5">
      <div className="grid grid-cols-3 gap-2">
        {steps.map(({ key, to, icon: Icon, label }) => (
          <NavLink key={key} to={to} aria-current={current === key ? 'page' : undefined}
            className={`focus-ring min-h-[52px] rounded-xl border flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-2 py-2 text-sm font-semibold ${current === key ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-surface-border bg-surface-raised text-ink hover:bg-surface'}`}>
            <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />{label}
          </NavLink>
        ))}
      </div>
      <p className="mt-2 text-sm text-ink-muted">{teacher
        ? 'เช็กชื่อได้ในชั้นที่รับผิดชอบ · เพิ่มหรือแก้รายชื่อและรถ ให้ผู้ดูแลโรงเรียนดำเนินการ'
        : 'เตรียมรถและรายชื่อครั้งแรกให้ครบ จากนั้นใช้ “เช็กชื่อวันนี้” ในแต่ละวัน'}</p>
    </nav>
  );
}
