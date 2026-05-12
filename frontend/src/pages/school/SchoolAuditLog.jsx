import { ShieldAlert } from 'lucide-react';
import AuditLogTable from '../../components/AuditLogTable';
import { AppCard } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { isGradeTeacher } from '../../utils/authScope';

export default function SchoolAuditLog() {
  const { user } = useAuth();
  // Phase 7.11.4 — backend returns 403 to teacher accounts on this
  // endpoint. Render a friendly denied card so the teacher sees a
  // meaningful message rather than the AuditLogTable's spinner-then-
  // error flash.
  if (isGradeTeacher(user)) {
    return (
      <div className="p-4 sm:p-6 max-w-3xl mx-auto">
        <AppCard padding="lg">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-6 h-6 text-warn shrink-0" strokeWidth={2} />
            <div>
              <h1 className="text-lg font-semibold text-ink mb-1">
                ไม่สามารถเข้าถึงหน้านี้ได้
              </h1>
              <p className="text-sm text-ink-muted">
                บัญชีครูประจำสายชั้นเข้าถึงได้เฉพาะข้อมูลสำหรับตรวจสอบเท่านั้น
                ประวัติการแก้ไขทั้งโรงเรียนจัดการโดยบัญชีหลักของโรงเรียน
              </p>
            </div>
          </div>
        </AppCard>
      </div>
    );
  }
  return <AuditLogTable apiPath="/school/audit-logs" title="ประวัติการแก้ไข" />;
}
