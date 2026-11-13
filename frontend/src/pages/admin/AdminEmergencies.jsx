import EmergencyListView from '../../components/EmergencyListView';

// ผู้ดูแลระบบดูและปิดเหตุฉุกเฉินได้ทุกคัน (POST /api/admin/emergencies/:id/close)
export default function AdminEmergencies() {
  return (
    <EmergencyListView
      basePath="/admin"
      title="เหตุฉุกเฉินทั้งระบบ"
      subtitle="ดูและปิดเหตุฉุกเฉินทุกคัน พร้อมบันทึกการแก้ไข"
      emptyDescription="ยังไม่มีรายงานเหตุฉุกเฉินในระบบ"
      closeResults={['RESOLVED', 'FALSE_ALARM', 'CLOSED']}
    />
  );
}
