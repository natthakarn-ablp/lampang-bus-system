import AuditLogTable from '../../components/AuditLogTable';

export default function AdminAuditLog() {
  return <AuditLogTable apiPath="/admin/audit-logs" title="ประวัติการใช้งานระบบ (ทั้งหมด)" />;
}
