import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bus } from 'lucide-react';
import api from '../../api/axios';
import PlateSearchInput from '../../components/PlateSearchInput';
import PageHeader from '../../components/PageHeader';
import VehicleRosterCard from '../../components/VehicleRosterCard';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';

export default function ProvVehicleList() {
  const [searchParams] = useSearchParams();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [plateSearch, setPlateSearch] = useState(searchParams.get('plate') || '');

  useEffect(() => {
    api.get('/province/vehicles')
      .then((res) => setVehicles(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  const shown = vehicles.filter(
    v => !plateSearch || v.plate_no.toLowerCase().includes(plateSearch.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="รถรับส่งทั้งจังหวัด"
        subtitle="ข้อมูลรถ คนขับ ผู้ดูแล และจำนวนนักเรียนที่ใช้บริการ"
        actions={<PlateSearchInput value={plateSearch} onChange={setPlateSearch} suggestions={vehicles} />}
      />

      {error && <ErrorState message={error} className="mb-4" />}

      {loading ? (
        <LoadingState />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Bus}
          title={plateSearch ? 'ไม่พบรถตามที่ค้นหา' : 'ไม่มีรถรับส่ง'}
          description={plateSearch ? 'ลองค้นด้วยทะเบียนอื่น' : 'ยังไม่มีรถในระบบ'}
        />
      ) : (
        <>
          <p className="text-sm text-ink-muted mb-3" aria-live="polite">
            {plateSearch ? 'พบ ' : 'ทั้งหมด '}
            <span className="font-semibold text-ink tabular-nums">{shown.length.toLocaleString('th-TH')}</span> คัน
          </p>
          <div className="grid gap-4">
            {shown.map(v => (
              <VehicleRosterCard key={v.id} vehicle={v} studentsPath="/province/students" />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
