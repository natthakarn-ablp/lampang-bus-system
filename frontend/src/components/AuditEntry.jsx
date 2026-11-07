import AppCard from './ui/AppCard';
import StatusBadge from './ui/StatusBadge';
import { auditActionTh, auditEntityTh } from '../constants/auditLabels';

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
  const actLabel  = auditActionTh(action);
  const entLabel  = auditEntityTh(entityType);

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
