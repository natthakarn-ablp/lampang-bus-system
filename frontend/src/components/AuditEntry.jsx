import AppCard from './ui/AppCard';
import StatusBadge from './ui/StatusBadge';

/**
 * AuditEntry — single audit-log entry as a card with left accent rail.
 *
 * Replaces the dense table-row pattern. Designed for AuditLogTable plus
 * any role-level audit-log view.
 *
 * Props:
 *   timestamp   — ISO string from `created_at`
 *   actor       — human-readable actor name (e.g. row.actor_name)
 *   action      — CREATE | UPDATE | DELETE | APPROVE | IMPORT | LOGIN | EXPORT
 *   entityType  — backend key (student / vehicle / user / …); mapped to Thai
 *   entityId    — optional row.entity_id (rendered as monospace small text)
 *   summary     — pre-formatted human summary (output of AuditLogTable.summarize)
 */

const ACTION_LABEL = {
  CREATE: 'สร้าง',  UPDATE: 'แก้ไข',  DELETE: 'ลบ',
  APPROVE: 'อนุมัติ', IMPORT: 'นำเข้า', LOGIN: 'เข้าสู่ระบบ',
  EXPORT: 'ส่งออก',
};

const ACTION_VARIANT = {
  CREATE:  'success',
  UPDATE:  'info',
  DELETE:  'danger',
  APPROVE: 'brand',
  IMPORT:  'warn',
  LOGIN:   'neutral',
  EXPORT:  'neutral',
};

const ACTION_RAIL = {
  success: 'before:bg-success',
  info:    'before:bg-info',
  danger:  'before:bg-danger',
  brand:   'before:bg-brand-700',
  warn:    'before:bg-warn',
  neutral: 'before:bg-surface-border',
};

const ENTITY_LABEL = {
  student: 'นักเรียน', vehicle: 'รถรับส่ง', user: 'บัญชีผู้ใช้',
  roster_request: 'คำขอรายชื่อ', leave: 'การลา', checkin: 'เช็กอิน',
  driver: 'คนขับ', driver_profile: 'ข้อมูลคนขับ', emergency: 'เหตุฉุกเฉิน',
};

function formatTime(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('th-TH', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default function AuditEntry({
  timestamp,
  actor,
  action,
  entityType,
  entityId,
  summary,
}) {
  const variant   = ACTION_VARIANT[action] || 'neutral';
  const rail      = ACTION_RAIL[variant];
  const actLabel  = ACTION_LABEL[action] || action;
  const entLabel  = ENTITY_LABEL[entityType] || entityType || null;

  return (
    <AppCard
      padding="sm"
      className={`relative pl-4 before:content-[''] before:absolute before:left-0 before:top-3 before:bottom-3 before:w-1 before:rounded-r-full ${rail}`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <StatusBadge variant={variant} size="sm">{actLabel}</StatusBadge>
        {entLabel && <StatusBadge variant="neutral" size="sm">{entLabel}</StatusBadge>}
        {entityId && (
          <span className="font-mono text-[11px] text-ink-muted">{entityId}</span>
        )}
        <span className="ml-auto text-xs text-ink-muted whitespace-nowrap">
          {formatTime(timestamp)}
        </span>
      </div>
      {summary && summary !== '-' && (
        <p className="text-sm text-ink leading-snug">{summary}</p>
      )}
      {actor && (
        <p className="text-xs text-ink-muted mt-1">โดย {actor}</p>
      )}
    </AppCard>
  );
}
