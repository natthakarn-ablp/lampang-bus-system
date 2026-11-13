import EmergencyListView from '../../components/EmergencyListView';

export default function ProvEmergencyList() {
  return (
    <EmergencyListView
      basePath="/province"
      title="เหตุฉุกเฉินทั้งจังหวัด"
      subtitle="เหตุฉุกเฉินที่รายงานจากทุกโรงเรียนในจังหวัด"
      emptyDescription="ยังไม่มีรายงานเหตุฉุกเฉินในระบบ"
    />
  );
}
