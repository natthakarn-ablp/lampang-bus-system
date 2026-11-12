import { useState, useEffect, useCallback } from 'react';
import { Route } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import { DataTable, FormField, StatusBadge } from '../../components/ui';

/**
 * รถที่วิ่งหลายเที่ยว (FEATURE_MULTI_TRIP, owner decision 2026-11-12) — the
 * same page for school, affiliation and province; the backend scopes the rows
 * (/api/{school|affiliation|province}/vehicle-trips). One row per bus + date +
 * round that ran more than one trip, with the reasons the driver chose.
 */

function todayBangkok() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function thaiDate(ymd) {
  const d = new Date(`${ymd}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium' });
}

const SUBTITLE = {
  school: 'รถของนักเรียนในโรงเรียนที่ต้องวิ่งมากกว่า 1 เที่ยวในรอบเดียว พร้อมเหตุผลที่คนขับเลือก',
  affiliation: 'รถที่รับส่งนักเรียนในสังกัดและต้องวิ่งมากกว่า 1 เที่ยวในรอบเดียว ใช้ประกอบการพิจารณาจัดรถเพิ่ม',
  province: 'รถทั้งจังหวัดที่ต้องวิ่งมากกว่า 1 เที่ยวในรอบเดียว ใช้ประกอบการพิจารณาจัดรถเพิ่ม',
};

export default function VehicleTripsReport({ role }) {
  const [dateFrom, setDateFrom] = useState(todayBangkok);
  const [dateTo, setDateTo] = useState(todayBangkok);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/${role}/vehicle-trips`, { params: { date_from: dateFrom, date_to: dateTo } });
      setRows(Array.isArray(res.data?.data?.rows) ? res.data.data.rows : []);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally { setLoading(false); }
  }, [role, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader title="รถที่วิ่งหลายเที่ยว" subtitle={SUBTITLE[role]} icon={Route} />

      <div className="flex flex-wrap gap-3 mb-4">
        <FormField label="ตั้งแต่วันที่" type="date" value={dateFrom} onChange={setDateFrom} className="w-44" />
        <FormField label="ถึงวันที่" type="date" value={dateTo} onChange={setDateTo} className="w-44" />
      </div>

      <DataTable
        caption="รถที่วิ่งมากกว่า 1 เที่ยวในรอบเดียว"
        loading={loading}
        error={error || null}
        onRetry={load}
        rows={rows}
        rowKey={(r) => `${r.check_date}|${r.session}|${r.vehicle_id}`}
        columns={[
          { key: 'plate', header: 'ทะเบียนรถ', primary: true, cell: (r) => <span className="font-medium text-ink">{r.plate_no}</span> },
          { key: 'date', header: 'วันที่', secondary: true,
            cell: (r) => `${thaiDate(r.check_date)} · ${r.session === 'morning' ? 'รอบเช้า' : 'รอบเย็น'}` },
          { key: 'trips', header: 'จำนวนเที่ยว', align: 'center', badge: true,
            cell: (r) => <StatusBadge variant="warn">{r.trips} เที่ยว</StatusBadge> },
          { key: 'reasons', header: 'เหตุผล', cell: (r) => r.reasons.join(' · ') },
        ]}
        empty={{
          icon: Route,
          title: 'ไม่มีรถที่วิ่งหลายเที่ยวในช่วงวันที่นี้',
          description: 'ลองเลือกช่วงวันที่อื่น (ได้ไม่เกิน 31 วัน)',
        }}
      />
    </div>
  );
}
