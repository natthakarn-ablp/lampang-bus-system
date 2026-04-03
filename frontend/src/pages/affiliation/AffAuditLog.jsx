import AuditLogTable from '../../components/AuditLogTable';

export default function AffAuditLog() {
  return <AuditLogTable apiPath="/affiliation/audit-logs" title="ประวัติการแก้ไข (สังกัด)" />;
}
