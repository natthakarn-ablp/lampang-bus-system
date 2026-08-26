import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map as MapIcon, RefreshCw, Bus, Building2, Users } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import { AlertBanner, KPIGrid, KPIStat, SearchableSelect, FormField} from '../../components/ui';
import ReadOnlyPickupPointMap from '../../components/ReadOnlyPickupPointMap';

const GRADE_OPTIONS = [
  '', 'อ.1','อ.2','อ.3',
  'ป.1','ป.2','ป.3','ป.4','ป.5','ป.6',
  'ม.1','ม.2','ม.3','ม.4','ม.5','ม.6',
];

const SESSION_OPTIONS = [
  { value: '',        label: 'ทั้งหมด' },
  { value: 'morning', label: 'เช้า' },
  { value: 'evening', label: 'เย็น' },
  { value: 'both',    label: 'เช้าและเย็น' },
];

export default function ProvincePickupMap() {
  const [points, setPoints]       = useState([]);
  const [summary, setSummary]     = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [permError, setPermError] = useState(false);
  const [selectedKey, setSelectedKey] = useState(null);

  const [filters, setFilters] = useState({
    affiliation_id: '', school_id: '', vehicle_id: '', session: '', grade: '', search: '',
  });

  // Phase 9.3 — capture dropdown options from the broadest (unfiltered) load
  // so narrowing a filter doesn't erase the other choices.
  const [optionSource, setOptionSource] = useState([]);
  const hasCapturedOptionsRef = useRef(false);

  const fetchData = useCallback(async (params) => {
    setLoading(true); setError(null); setPermError(false);
    try {
      const q = {};
      for (const [k, v] of Object.entries(params)) {
        if (v && String(v).trim()) q[k] = String(v).trim();
      }
      const res = await api.get('/province/pickup-map', { params: q });
      const pointsList = Array.isArray(res.data?.data?.points) ? res.data.data.points : [];
      setPoints(pointsList);
      setSummary(res.data?.data?.summary || null);
      if (!hasCapturedOptionsRef.current && pointsList.length > 0) {
        setOptionSource(pointsList);
        hasCapturedOptionsRef.current = true;
      }
    } catch (err) {
      if (err?.response?.status === 403) {
        setPermError(true);
      } else {
        setError(err?.response?.data?.message || 'โหลดข้อมูลแผนที่จุดรับส่งไม่สำเร็จ');
      }
      setPoints([]); setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(filters); }, [fetchData]);

  // Phase 9.3 — name-first dropdowns derived from the broadest snapshot.
  const affiliationOptions = useMemo(
    () => uniqOptions(optionSource, 'affiliation_id', 'affiliation_name'),
    [optionSource]
  );
  const schoolOptions = useMemo(
    () => uniqOptions(optionSource, 'school_id', 'school_name'),
    [optionSource]
  );
  const vehicleOptions = useMemo(
    () => uniqOptions(optionSource, 'vehicle_id', 'plate_no'),
    [optionSource]
  );

  function handleApplyFilters(e) {
    e?.preventDefault?.();
    setSelectedKey(null);
    fetchData(filters);
  }
  function handleReset() {
    const empty = { affiliation_id: '', school_id: '', vehicle_id: '', session: '', grade: '', search: '' };
    setFilters(empty); setSelectedKey(null); fetchData(empty);
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <PageHeader
        title="แผนที่จุดรับส่ง"
        subtitle="แสดงภาพรวมจุดรับส่งนักเรียนระดับจังหวัด"
        icon={MapIcon}
      />

      {permError && (
        <AlertBanner variant="warn" title="ไม่มีสิทธิ์เข้าถึงข้อมูลนี้">
          บัญชีของคุณไม่มีสิทธิ์เข้าถึงข้อมูลในหน้านี้
        </AlertBanner>
      )}

      <KPIGrid cols={4}>
        <KPIStat label="จุดรับส่งทั้งหมด"   value={summary?.total_points ?? '–'}            icon={MapIcon}   variant="brand" />
        <KPIStat label="นักเรียนในขอบเขต"   value={summary?.total_students_in_scope ?? '–'} icon={Users}     variant="info" />
        <KPIStat label="โรงเรียนที่เกี่ยวข้อง" value={summary?.total_schools ?? '–'}         icon={Building2} variant="neutral" />
        <KPIStat label="รถที่เกี่ยวข้อง"     value={summary?.total_vehicles ?? '–'}          icon={Bus}       variant="success" />
      </KPIGrid>

      <form
        onSubmit={handleApplyFilters}
        className="bg-surface-raised border border-surface-border rounded-2xl shadow-soft p-4 flex flex-wrap items-end gap-3"
      >
        <Field label="ค้นหา" placeholder="ชื่อจุดรับส่ง / ป้ายทะเบียน / โรงเรียน"
          value={filters.search} onChange={(v) => setFilters(s => ({ ...s, search: v }))}
        />
        <Select label="รอบ" value={filters.session} options={SESSION_OPTIONS}
          onChange={(v) => setFilters(s => ({ ...s, session: v }))}
        />
        <Select label="ระดับชั้น" value={filters.grade}
          options={GRADE_OPTIONS.map(g => ({ value: g, label: g || 'ทั้งหมด' }))}
          onChange={(v) => setFilters(s => ({ ...s, grade: v }))}
        />
        <SearchableSelect label="สังกัด" value={filters.affiliation_id}
          options={affiliationOptions}
          placeholder="เลือกสังกัด"
          searchPlaceholder="ค้นหาชื่อสังกัด…"
          onChange={(v) => setFilters(s => ({ ...s, affiliation_id: v }))}
        />
        <SearchableSelect label="โรงเรียน" value={filters.school_id}
          options={schoolOptions}
          placeholder="เลือกโรงเรียน"
          searchPlaceholder="ค้นหาชื่อโรงเรียน…"
          onChange={(v) => setFilters(s => ({ ...s, school_id: v }))}
        />
        <SearchableSelect label="รถรับส่ง" value={filters.vehicle_id}
          options={vehicleOptions}
          placeholder="เลือกรถ"
          searchPlaceholder="ค้นหาทะเบียน…"
          onChange={(v) => setFilters(s => ({ ...s, vehicle_id: v }))}
        />
        <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
          <button type="submit" disabled={loading}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-brand hover:bg-brand-700 disabled:bg-brand/60 text-white text-sm font-medium px-3 py-2.5 sm:py-2 rounded-lg transition min-h-[40px]">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={2} />
            {loading ? 'กำลังโหลด…' : 'ใช้ตัวกรอง'}
          </button>
          <button type="button" onClick={handleReset} disabled={loading}
            className="text-sm text-ink-muted hover:text-ink px-3 py-2.5 sm:py-2 rounded-lg transition disabled:opacity-50 min-h-[40px]">
            ล้างตัวกรอง
          </button>
        </div>
      </form>

      {!permError && (
        <ReadOnlyPickupPointMap
          points={points}
          loading={loading}
          error={error}
          selectedKey={selectedKey}
          onSelect={(k) => setSelectedKey(k)}
          showSchool
          showAffiliation
          emptyMessage="ยังไม่มีจุดรับส่งในขอบเขตของจังหวัด"
        />
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <FormField
      className="w-full sm:w-auto sm:min-w-[160px]"
      label={label}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
  );
}
function Select({ label, value, onChange, options }) {
  return (
    <FormField className="w-full sm:w-auto sm:min-w-[140px]" label={label}>
      {ctl => (
        <select
          {...ctl}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base sm:text-sm text-ink transition"
        >
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </FormField>
  );
}

/**
 * Phase 9.3 — collect unique {value,label} entries from a points snapshot,
 * sorted by Thai-collated label, for name-first dropdowns.
 */
function uniqOptions(rows, idKey, labelKey) {
  const seen = new Map();
  for (const r of rows) {
    const id = r?.[idKey];
    if (id == null || id === '') continue;
    if (!seen.has(id)) seen.set(id, r?.[labelKey] || String(id));
  }
  return Array.from(seen, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'th'));
}
