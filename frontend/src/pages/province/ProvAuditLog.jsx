import AuditLogTable from '../../components/AuditLogTable';

export default function ProvAuditLog() {
  return <AuditLogTable apiPath="/province/audit-logs" title="ประวัติการแก้ไข (จังหวัด)" />;
}
