import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import api from '../../api/axios';
import ErrorState from '../../components/ErrorState';
import PageHeader from '../../components/PageHeader';
import { DataTable, FilterBar, StatusBadge } from '../../components/ui';
import Pagination from '../../components/Pagination';

export default function ProvStudentSearch() {
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ page: 1, per_page: 20, total: 0 });

  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('');
  const [affFilter, setAffFilter] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('');
  const [affiliations, setAffiliations] = useState([]);
  const [schools, setSchools] = useState([]);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    api.get('/province/affiliations').then((res) => setAffiliations(Array.isArray(res.data.data) ? res.data.data : [])).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (affFilter) params.set('affiliation_id', affFilter);
    api.get(`/province/schools?per_page=200&${params}`).then((res) => setSchools(Array.isArray(res.data.data) ? res.data.data : [])).catch(() => {});
  }, [affFilter]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchStudents = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('per_page', '20');
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (grade) params.set('grade', grade);
      if (affFilter) params.set('affiliation_id', affFilter);
      if (schoolFilter) params.set('school_id', schoolFilter);

      const res = await api.get(`/province/students?${params}`);
      setStudents(Array.isArray(res.data.data) ? res.data.data : []);
      setMeta(res.data.meta);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, grade, affFilter, schoolFilter]);

  useEffect(() => {
    fetchStudents(1);
  }, [fetchStudents]);

  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  const hasFilter = Boolean(debouncedSearch || grade || affFilter || schoolFilter);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="ข้อมูลนักเรียน"
        subtitle="ค้นหานักเรียนที่ใช้บริการรถรับส่งทั้งจังหวัด"
      />

      <FilterBar
        className="mb-5"
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'ค้นหาชื่อ นามสกุล หรือรหัส…',
          label: 'ค้นหานักเรียนด้วยชื่อ นามสกุล หรือรหัส',
        }}
        filters={[
          { key: 'grade', label: 'กรองตามระดับชั้น', value: grade, onChange: setGrade,
            options: [['', 'ทุกชั้น'], ...['อ.1','อ.2','อ.3','ป.1','ป.2','ป.3','ป.4','ป.5','ป.6','ม.1','ม.2','ม.3','ม.4','ม.5','ม.6'].map(g => [g, g])] },
          { key: 'affiliation', label: 'กรองตามสังกัด', value: affFilter,
            onChange: v => { setAffFilter(v); setSchoolFilter(''); },
            options: [['', 'ทุกสังกัด'], ...affiliations.map(a => [a.id, a.name])] },
          { key: 'school', label: 'กรองตามโรงเรียน', value: schoolFilter, onChange: setSchoolFilter,
            options: [['', 'ทุกโรงเรียน'], ...schools.map(sc => [sc.id, sc.name])] },
        ]}
        count={meta.total}
        countLabel="คน"
        onClear={() => { setSearch(''); setGrade(''); setAffFilter(''); setSchoolFilter(''); }}
      />

      {error && <ErrorState message={error} className="mb-4" onRetry={() => fetchStudents(meta.page)} />}

      <DataTable
        caption="รายชื่อนักเรียนที่ใช้บริการรถรับส่ง"
        loading={loading}
        rows={students}
        rowKey={s => s.id}
        columns={[
          { key: 'name', header: 'ชื่อ-นามสกุล', primary: true,
            cell: s => <span className="font-medium text-ink">{s.prefix}{s.first_name} {s.last_name}</span> },
          { key: 'grade', header: 'ชั้น/ห้อง', secondary: true,
            cell: s => (s.grade && s.classroom ? `${s.grade}/${s.classroom}` : s.grade || '-') },
          { key: 'id', header: 'รหัส', cell: s => <span className="tabular-nums">{s.id}</span> },
          { key: 'school', header: 'โรงเรียน', cell: s => s.school_name || '-' },
          { key: 'affiliation', header: 'สังกัด', cell: s => s.affiliation_name || '-' },
          { key: 'plate', header: 'ทะเบียนรถ', align: 'center',
            cell: s => (s.plate_no
              ? (
                <button
                  onClick={() => navigate(`/province/vehicles?plate=${encodeURIComponent(s.plate_no)}`)}
                  className="focus-ring inline-flex items-center min-h-[44px] px-2 -mx-2 rounded-lg text-brand-700 hover:bg-brand-50 active:bg-brand-100 transition"
                >
                  {s.plate_no}
                </button>
              )
              : <span className="text-ink-muted">ไม่มีรถ</span>) },
          { key: 'sessions', header: 'รอบที่ใช้', badge: true,
            /* The old cells used a bare ✅ / — pair, which carries meaning by
               symbol alone. Spelled out instead so it survives a screen reader
               and a monochrome print. */
            cell: s => {
              const used = [s.morning_enabled && 'เช้า', s.evening_enabled && 'เย็น'].filter(Boolean);
              return used.length
                ? <StatusBadge variant="success">{used.join(' · ')}</StatusBadge>
                : <StatusBadge variant="neutral">ไม่ใช้บริการ</StatusBadge>;
            } },
        ]}
        empty={{
          icon: GraduationCap,
          title: 'ไม่พบนักเรียน',
          description: 'ลองเปลี่ยนคำค้นหรือตัวกรอง',
        }}
      />

      {students.length > 0 && (
        <Pagination page={meta.page} totalPages={totalPages} total={meta.total} shown={students.length} onPage={(p) => fetchStudents(p)} />
      )}
    </div>
  );
}
