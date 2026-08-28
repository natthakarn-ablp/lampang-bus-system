import { Eye } from 'lucide-react';
import { StatusBadge } from './ui';
import { getGradeScope } from '../utils/authScope';

/**
 * The one place that says, on screen, how narrow a homeroom-teacher account's
 * view is. Renders nothing for a full school account or any other role.
 *
 * It lived inside SchoolLayout, so /reports had no such statement — and once
 * reports became grade-filtered (AUD-004) that page showed a teacher one
 * grade's numbers under headings that read like the whole school's. A reader
 * who cannot see the boundary has no way to tell a quiet day from a filter.
 *
 * Kept as a component rather than the getScopeLabel() string helper because
 * both call sites want the badge, and the string was being hand-copied.
 */
export default function TeacherScopeChip({ user, note = 'บัญชีครูประจำสายชั้น — ดูข้อมูลได้อย่างเดียว' }) {
  const grade = getGradeScope(user);
  if (!grade) return null;
  return (
    <div className="px-4 sm:px-6 pt-3">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-2">
        <StatusBadge variant="info" size="md" icon={Eye}>
          ขอบเขตข้อมูล: {grade}
        </StatusBadge>
        {note && <span className="text-xs text-ink-muted">{note}</span>}
      </div>
    </div>
  );
}
