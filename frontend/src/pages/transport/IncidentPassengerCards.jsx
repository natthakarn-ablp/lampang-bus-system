import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';

const EVENT_LABELS = {
  CHECKED_IN: ['บันทึกขึ้นรถ', 'info'], CHECKED_OUT: ['บันทึกลงรถ', 'success'],
  ABSENT: ['บันทึกสถานะขาด', 'neutral'], CANCELLED: ['ยกเลิกรายการของนักเรียนนี้', 'warn'],
};

export function incidentTime(value) {
  if (!value) return 'ยังไม่ระบุ';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'ยังไม่ระบุ' : date.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export default function IncidentPassengerCards({ rows, events = false }) {
  return <ul className="grid gap-3 lg:grid-cols-2">{rows.map(row => {
    const [label, variant] = EVENT_LABELS[row.status] || ['ยังยืนยันไม่ได้', 'neutral'];
    return <li key={row.id} className="min-w-0">
      <AppCard padding="md" className="h-full space-y-3">
        {/* Shared table cards truncate names; incident names must wrap fully. */}
        <div className="min-w-0 space-y-1">
          <h3 className="text-lg font-semibold leading-relaxed text-ink break-words">{row.name}</h3>
          <p className="text-base leading-relaxed text-ink-muted break-words">{row.school_name || 'ยังไม่ระบุโรงเรียน'}</p>
        </div>
        {events ? <div className="flex flex-wrap items-center gap-2">
          <StatusBadge variant={variant}>{label}</StatusBadge>
          <p className="text-sm text-ink">เวลาบันทึก {incidentTime(row.checked_at)}</p>
        </div> : <>
          <dl className="text-sm leading-relaxed">
            <dt className="text-ink-muted">จุดรับส่งที่จัดไว้</dt>
            <dd className="text-ink break-words">{row.pickup_points.length ? row.pickup_points.join(' / ') : 'ยังไม่มีข้อมูลจุดรับส่ง'}</dd>
          </dl>
          <p className="text-sm text-ink-muted">ปรับข้อมูลนักเรียน {incidentTime(row.updated_at)}</p>
        </>}
      </AppCard>
    </li>;
  })}</ul>;
}
