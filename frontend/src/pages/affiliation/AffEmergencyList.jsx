import EmergencyListView from '../../components/EmergencyListView';

export default function AffEmergencyList() {
  return (
    <EmergencyListView
      basePath="/affiliation"
      subtitle="เหตุฉุกเฉินที่รายงานจากโรงเรียนในสังกัด"
      emptyDescription="ยังไม่มีรายงานเหตุฉุกเฉินจากรถในสังกัดนี้"
    />
  );
}
