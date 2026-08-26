import { useState, useEffect, useCallback } from 'react';
import { Building2 } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import Pagination from '../../components/Pagination';
import { DataTable, FilterBar } from '../../components/ui';

export default function ProvSchoolList() {
  const [schools, setSchools] = useState([]);
  const [affiliations, setAffiliations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ page: 1, per_page: 50, total: 0 });
  const [affFilter, setAffFilter] = useState('');

  useEffect(() => {
    api.get('/province/affiliations')
      .then((res) => setAffiliations(Array.isArray(res.data.data) ? res.data.data : []))
      .catch(() => {});
  }, []);

  const fetchSchools = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('per_page', '50');
      if (affFilter) params.set('affiliation_id', affFilter);

      const res = await api.get(`/province/schools?${params}`);
      setSchools(Array.isArray(res.data.data) ? res.data.data : []);
      setMeta(res.data.meta);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [affFilter]);

  useEffect(() => {
    fetchSchools(1);
  }, [fetchSchools]);

  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="โรงเรียนทั้งหมด"
        subtitle="โรงเรียนที่ใช้ระบบรถรับส่งในจังหวัด พร้อมจำนวนนักเรียนและรถ"
      />

      <FilterBar
        className="mb-5"
        filters={[{
          key: 'affiliation',
          label: 'กรองตามสังกัด',
          value: affFilter,
          onChange: setAffFilter,
          options: [['', 'ทุกสังกัด'], ...affiliations.map(a => [a.id, a.name])],
        }]}
        count={meta.total}
        countLabel="โรงเรียน"
        onClear={() => setAffFilter('')}
      />

      {error && <ErrorState message={error} className="mb-4" onRetry={() => fetchSchools(meta.page)} />}

      <DataTable
        caption="รายชื่อโรงเรียนในจังหวัด"
        loading={loading}
        rows={schools}
        rowKey={s => s.id}
        columns={[
          { key: 'name', header: 'โรงเรียน', primary: true,
            cell: s => <span className="font-medium text-ink">{s.name}</span> },
          { key: 'affiliation', header: 'สังกัด', secondary: true,
            cell: s => s.affiliation_name || '-' },
          { key: 'students', header: 'นักเรียน', numeric: true,
            cell: s => `${(s.student_count ?? 0).toLocaleString('th-TH')} คน` },
          { key: 'vehicles', header: 'รถ', numeric: true,
            cell: s => `${(s.vehicle_count ?? 0).toLocaleString('th-TH')} คัน` },
        ]}
        empty={{
          icon: Building2,
          title: 'ไม่พบโรงเรียน',
          description: affFilter ? 'ลองเลือกสังกัดอื่น' : 'ยังไม่มีโรงเรียนในระบบ',
        }}
      />

      {totalPages > 1 && (
        <Pagination page={meta.page} totalPages={totalPages} total={meta.total} shown={schools.length} onPage={(p) => fetchSchools(p)} />
      )}
    </div>
  );
}
