import { Users } from 'lucide-react';
import { DataTable, StatusBadge } from './ui';
import { formatGradeClass } from '../utils/student';

/**
 * StudentStatusTable — per-pupil morning/evening check status for one vehicle.
 *
 * The province daily status, affiliation daily status and school dashboard each
 * carried their own copy of this table, nested several levels inside their
 * expandable trees, with slightly different padding and slightly different
 * colours for the same three states.
 *
 * The state was conveyed as "✓ 07:42" in green, "รอ" in orange, or a grey "-".
 * A tick and a dash are symbols, not words: they do not survive a screen reader
 * or a monochrome print, and orange-vs-green was doing the rest of the work.
 * Each state now reads as a labelled badge, with the time alongside it.
 */
function sessionCell(enabled, done, ts) {
  if (!enabled) return <span className="text-ink-muted">ไม่ใช้บริการ</span>;
  if (!done) return <StatusBadge variant="warn">รอดำเนินการ</StatusBadge>;
  const time = ts ? new Date(ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusBadge variant="success">เรียบร้อย</StatusBadge>
      {time && <span className="text-caption text-ink-muted tabular-nums">{time}</span>}
    </span>
  );
}

/**
 * `renderStatus(student, session)` lets a caller keep a richer cell than the
 * default. The school dashboard uses it to show leave-of-absence, which the
 * province and affiliation payloads do not carry.
 * `rowClassName` likewise lets the school dashboard keep its leave highlight.
 */
export default function StudentStatusTable({
  students = [],
  caption,
  renderStatus,
  rowClassName,
}) {
  const cell = (st, session) => (renderStatus
    ? renderStatus(st, session)
    : sessionCell(
        session === 'morning' ? st.morning_enabled : st.evening_enabled,
        session === 'morning' ? st.morning_done : st.evening_done,
        session === 'morning' ? st.morning_ts : st.evening_ts,
      ));

  return (
    <DataTable
      caption={caption}
      rows={students}
      rowKey={st => st.id}
      rowClassName={rowClassName}
      columns={[
        { key: 'name', header: 'ชื่อ', primary: true, cell: st => st.name },
        { key: 'grade', header: 'ชั้น/ห้อง', secondary: true,
          cell: st => formatGradeClass(st.grade, st.classroom) },
        { key: 'morning', header: 'ส่งเช้า', align: 'center', cell: st => cell(st, 'morning') },
        { key: 'evening', header: 'รับเย็น', align: 'center', cell: st => cell(st, 'evening') },
      ]}
      empty={{ icon: Users, title: 'ไม่มีนักเรียนในรถคันนี้' }}
    />
  );
}
