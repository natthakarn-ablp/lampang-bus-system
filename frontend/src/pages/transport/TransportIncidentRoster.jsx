import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { AlertBanner, AppCard, DataTable, StatusBadge } from '../../components/ui';
import { bangkokDateDaysAgo, todayBangkok } from '../../utils/thaiTime';

const EVENT_LABELS = {
  CHECKED_IN: ['บันทึกขึ้นรถ', 'info'],
  CHECKED_OUT: ['บันทึกลงรถ', 'success'],
  ABSENT: ['บันทึกไม่ขึ้นรถ', 'neutral'],
  CANCELLED: ['ยกเลิกรายการก่อนหน้า', 'warn'],
};

function time(value) {
  if (!value) return 'ไม่ระบุ';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'ไม่ระบุ' : date.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export default function TransportIncidentRoster() {
  const { id } = useParams();
  const [date, setDate] = useState(todayBangkok);
  const [session, setSession] = useState('morning');
  const [selection, setSelection] = useState(() => ({ date: todayBangkok(), session: 'morning' }));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError(false);
    api.get(`/transport/vehicles/${encodeURIComponent(id)}/incident-roster`, {
      params: selection, signal: controller.signal,
    }).then(response => {
      if (!controller.signal.aborted) setData(response.data.data);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [id, selection, retry]);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <Link to="/transport/vehicles" className="inline-flex min-h-11 items-center text-brand-700 underline focus-ring rounded-lg">กลับไปค้นทะเบียนรถ</Link>
      <PageHeader title="ข้อมูลรถและนักเรียนกรณีเกิดเหตุ" subtitle="สำหรับเจ้าหน้าที่ขนส่งตามหน้าที่ การเปิดดูมีการบันทึกประวัติ" />
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault();
        setSelection({ date, session });
      }}>
        <label className="min-w-0 flex-1 sm:flex-none text-sm font-medium text-ink">
          วันที่ของบันทึกขึ้น–ลง
          <input type="date" value={date} min={bangkokDateDaysAgo(30)} max={todayBangkok()} required
            onChange={event => setDate(event.target.value)} className="mt-1 block w-full min-h-11 rounded-lg border border-surface-border p-2 focus-ring" />
        </label>
        <label className="text-sm font-medium text-ink">
          รอบรถ
          <select value={session} onChange={event => setSession(event.target.value)}
            className="mt-1 block min-h-11 rounded-lg border border-surface-border p-2 focus-ring">
            <option value="morning">รอบเช้า</option><option value="evening">รอบเย็น</option>
          </select>
        </label>
        <button type="submit" className="min-h-11 rounded-lg bg-brand-700 px-4 text-white font-medium focus-ring">ดูข้อมูลล่าสุด</button>
      </form>

      {loading && <LoadingState />}
      {!loading && error && <ErrorState message="ไม่สามารถเปิดข้อมูลรถได้ กรุณาตรวจสอบสิทธิ์และลองใหม่" onRetry={() => setRetry(value => value + 1)} />}
      {!loading && !error && data && <>
        <AppCard className="p-4 sm:p-5">
          <h2 className="text-xl font-semibold text-ink break-words">{data.vehicle.plate_no}</h2>
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div><dt className="text-ink-muted">ประเภทรถ</dt><dd>{data.vehicle.vehicle_type || 'ยังไม่ระบุ'}</dd></div>
            <div><dt className="text-ink-muted">คนขับที่มอบหมายปัจจุบัน</dt><dd>{data.vehicle.driver_names.length ? data.vehicle.driver_names.join(' / ') : 'ยังไม่ระบุ'} (ไม่ยืนยันผู้ขับในรอบนี้)</dd></div>
            <div><dt className="text-ink-muted">จำนวนที่นั่งที่รับรอง</dt><dd>{data.vehicle.certified_capacity ?? 'ยังไม่ระบุ'}</dd></div>
          </dl>
          <p className="mt-3 text-sm text-ink-muted">ดึงข้อมูลเมื่อ {time(data.fetched_at)}</p>
        </AppCard>
        <AlertBanner variant="warn" title="รายชื่อประจำรถไม่ได้ยืนยันว่าอยู่บนรถขณะนี้">
          <p>ใช้บันทึกขึ้น–ลงประกอบการตรวจสอบกับผู้รับผิดชอบ หากไม่มีบันทึก ให้ถือว่ายังยืนยันไม่ได้ ไม่ใช่สรุปว่าเด็กไม่ได้ขึ้นรถ ข้อมูลนี้ไม่ใช่ตำแหน่งรถปัจจุบัน</p>
        </AlertBanner>
        <section aria-labelledby="incident-events-title" className="space-y-3">
          <h2 id="incident-events-title" className="text-lg font-semibold text-ink">บันทึกขึ้น–ลง วันที่ {data.date} · {data.session === 'morning' ? 'รอบเช้า' : 'รอบเย็น'}</h2>
          <p className="text-sm text-ink-muted">เรียงตามลำดับบันทึก ยกเลิกรายการหมายถึงต้องตรวจสอบรายการก่อนหน้าด้วย เวลาเป็นเวลาที่ระบบบันทึก ไม่ใช่เวลาหรือจุดที่ตรวจยืนยันด้วยตำแหน่ง</p>
          <DataTable rows={data.recorded_events} caption="บันทึกขึ้น–ลงของรถตามวันที่และรอบที่เลือก" columns={[
            { key: 'name', header: 'ชื่อนักเรียน', primary: true, cell: row => row.name },
            { key: 'school', header: 'โรงเรียนปัจจุบัน', secondary: true, cell: row => row.school_name || 'ยังไม่ระบุ' },
            { key: 'status', header: 'รายการที่บันทึก', badge: true, cell: row => {
              const [label, variant] = EVENT_LABELS[row.status] || ['ยังยืนยันไม่ได้', 'neutral'];
              return <StatusBadge variant={variant}>{label}</StatusBadge>;
            } },
            { key: 'time', header: 'เวลาบันทึก', cell: row => time(row.checked_at) },
          ]} empty={{ title: 'ไม่พบบันทึกขึ้น–ลงในวันที่และรอบนี้', description: 'ยังยืนยันการขึ้นรถไม่ได้ กรุณาตรวจสอบกับผู้รับผิดชอบ' }} />
        </section>
        <section aria-labelledby="incident-roster-title" className="space-y-3">
          <h2 id="incident-roster-title" className="text-lg font-semibold text-ink">รายชื่อนักเรียนประจำรถปัจจุบัน · {data.session === 'morning' ? 'รอบเช้า' : 'รอบเย็น'} · {data.current_roster.length} คน</h2>
          <p className="text-sm text-ink-muted">รายชื่อ โรงเรียนและจุดรับส่งเป็นข้อมูลที่จัดไว้ในปัจจุบัน แม้เลือกดูบันทึกย้อนหลัง จุดรับส่งไม่ใช่หลักฐานจุดที่ขึ้นหรือลงจริง</p>
          <DataTable rows={data.current_roster} caption="รายชื่อและจุดรับส่งที่จัดไว้กับรถในปัจจุบัน" columns={[
            { key: 'name', header: 'ชื่อนักเรียน', primary: true, cell: row => row.name },
            { key: 'school', header: 'โรงเรียน', secondary: true, cell: row => row.school_name || 'ยังไม่ระบุ' },
            { key: 'points', header: 'จุดรับส่งที่จัดไว้', cell: row => row.pickup_points.length ? row.pickup_points.join(' / ') : 'ยังไม่มีจุดรับส่งที่ผูกไว้' },
            { key: 'updated', header: 'ปรับข้อมูลนักเรียนล่าสุด', cell: row => time(row.updated_at) },
          ]} empty={{ title: 'ยังไม่มีรายชื่อนักเรียนประจำรถในรอบนี้', description: 'ตรวจสอบบันทึกขึ้น–ลงด้านบนและยืนยันกับโรงเรียนอีกครั้ง' }} />
        </section>
      </>}
    </div>
  );
}
