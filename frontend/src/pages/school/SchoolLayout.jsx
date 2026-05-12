import { Outlet } from 'react-router-dom';
import { Eye } from 'lucide-react';
import Layout from '../../components/Layout';
import { useAuth } from '../../hooks/useAuth';
import { useAdminContext } from '../../hooks/useAdminContext';
import { AdminSchoolSelector, AdminNoScopeMessage } from '../../components/AdminScopeSelector';
import { StatusBadge } from '../../components/ui';
import { isGradeTeacher, getGradeScope } from '../../utils/authScope';

/**
 * Phase 7.11.4 — when a homeroom-teacher account is logged in,
 * render a single scope chip + read-only hint above every school
 * page. Backend has already filtered the data; this is just a
 * clear visual reminder of why the page looks narrower than usual.
 */
function TeacherScopeChip({ user }) {
  const grade = getGradeScope(user);
  if (!grade) return null;
  return (
    <div className="px-4 sm:px-6 pt-3">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-2">
        <StatusBadge variant="info" size="md" icon={Eye}>
          ขอบเขตข้อมูล: {grade}
        </StatusBadge>
        <span className="text-xs text-ink-muted">
          บัญชีครูประจำสายชั้น — ดูข้อมูลได้อย่างเดียว
        </span>
      </div>
    </div>
  );
}

export default function SchoolLayout() {
  const { user } = useAuth();
  const { schoolId } = useAdminContext();
  const isAdmin = user?.role === 'admin';
  const hasScope = isAdmin ? !!schoolId : !!user?.scope_id;
  const teacher = isGradeTeacher(user);

  return (
    <Layout>
      {isAdmin && <AdminSchoolSelector />}
      {teacher && <TeacherScopeChip user={user} />}
      {hasScope ? <Outlet /> : isAdmin ? <AdminNoScopeMessage type="school" /> : <Outlet />}
    </Layout>
  );
}
