import EmergencyListView from '../../components/EmergencyListView';
import { useAuth } from '../../hooks/useAuth';
import { isGradeTeacher } from '../../utils/authScope';

// โรงเรียนปิดเหตุได้เฉพาะรถที่นักเรียนของโรงเรียนใช้ (backend ตรวจ scope) —
// บัญชีครูประจำสายชั้นดูได้อย่างเดียว
export default function EmergencyList() {
  const { user } = useAuth();
  return (
    <EmergencyListView
      basePath="/school"
      subtitle="เหตุฉุกเฉินที่รายงานจากรถรับส่งของโรงเรียน"
      emptyDescription="ยังไม่มีรายงานเหตุฉุกเฉินจากรถที่ให้บริการโรงเรียนนี้"
      canClose={!isGradeTeacher(user)}
    />
  );
}
