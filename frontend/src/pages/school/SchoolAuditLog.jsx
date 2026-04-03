import AuditLogTable from '../../components/AuditLogTable';

export default function SchoolAuditLog() {
  return <AuditLogTable apiPath="/school/audit-logs" title="ประวัติการแก้ไข" />;
}
