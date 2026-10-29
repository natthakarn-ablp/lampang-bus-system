import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Bus, RefreshCw, Search } from 'lucide-react';
import api from '../../api/axios';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import PageHeader from '../../components/PageHeader';
import { AlertBanner, AppCard, FormField } from '../../components/ui';
import { bangkokDateDaysAgo, todayBangkok } from '../../utils/thaiTime';
import { filterIncidentRows, incidentDateError, incidentErrorMessage, incidentPhase } from '../../utils/transportIncidentView';
import IncidentPassengerCards, { incidentTime } from './IncidentPassengerCards';

function calendarLabel(value) {
  return new Date(`${value}T12:00:00+07:00`).toLocaleDateString('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export default function TransportIncidentRoster() {
  const { id } = useParams();
  const [date, setDate] = useState(todayBangkok);
  const [session, setSession] = useState('morning');
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [view, setView] = useState('roster');
  const [load, setLoad] = useState({ key: '', phase: 'loading' });
  const today = todayBangkok();
  const earliest = bangkokDateDaysAgo(30);
  const dateError = incidentDateError(date, today, earliest);
  const requestKey = `${id}:${date}:${session}:${retry}`;
  const phase = incidentPhase(load, requestKey);
  const data = !dateError && phase === 'ready' ? load.data : null;
  const vehicle = load.data?.vehicle?.id === id ? load.data.vehicle : null;
  const busy = !dateError && phase === 'loading';

  useEffect(() => { setQuery(''); setView('roster'); }, [id]);
  useEffect(() => {
    if (dateError) return;
    const controller = new AbortController();
    setLoad(previous => ({ key: requestKey, phase: 'loading', data: previous.data }));
    api.get(`/transport/vehicles/${encodeURIComponent(id)}/incident-roster`, {
      params: { date, session }, signal: controller.signal,
    }).then(response => {
      if (!controller.signal.aborted) setLoad({ key: requestKey, phase: 'ready', data: response.data.data });
    }).catch(error => {
      if (!controller.signal.aborted) setLoad(previous => ({ key: requestKey, phase: 'error', message: incidentErrorMessage(error.response?.status), data: previous.data }));
    });
    return () => controller.abort();
  }, [id, date, session, requestKey, dateError]);

  const allRows = data ? (view === 'roster' ? data.current_roster : data.recorded_events) : [];
  const matches = filterIncidentRows(allRows, query);
  const rows = view === 'events' ? [...matches].reverse() : matches;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title={vehicle?.plate_no || 'ข้อมูลรถที่เลือก'}
        subtitle="ข้อมูลรถและนักเรียนเมื่อเกิดเหตุ"
        meta={data ? `ดึงข้อมูล ${incidentTime(data.fetched_at)}` : undefined}
        icon={Bus}
        iconColor="amber"
        breadcrumb={[{ label: 'รถรับส่ง', to: '/transport/vehicles' }, { label: 'รายชื่อเมื่อเกิดเหตุ' }]}
        actions={<button type="button" disabled={busy || !!dateError} onClick={() => setRetry(value => value + 1)}
          className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border border-surface-border bg-surface-raised px-4 font-medium text-ink disabled:opacity-50">
          <RefreshCw size={18} aria-hidden="true" /> อัปเดตข้อมูล
        </button>}
      />
      <AppCard padding="md">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="วันที่ของบันทึกขึ้น–ลง"
            type="date"
            value={date}
            onChange={setDate}
            min={earliest}
            max={today}
            required
            error={dateError || undefined}
            helper="เลือกย้อนหลังได้ 30 วัน เปลี่ยนแล้วแสดงข้อมูลทันที"
          />
          <fieldset className="min-w-0">
            <legend className="text-sm font-semibold text-ink">รอบรถ</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[['morning', 'รอบเช้า'], ['evening', 'รอบเย็น']].map(([value, label]) => <button key={value} type="button"
                aria-pressed={session === value} onClick={() => setSession(value)}
                className={`focus-ring min-h-12 rounded-xl border px-3 text-base font-semibold ${session === value ? 'border-brand-700 bg-brand-700 text-white' : 'border-surface-border bg-surface-raised text-ink'}`}>{label}</button>)}
            </div>
          </fieldset>
        </div>
      </AppCard>
      {busy && <LoadingState message="กำลังโหลดรายชื่อและบันทึกของรอบที่เลือก…" />}
      {!dateError && phase === 'error' && <ErrorState message={load.message} onRetry={() => setRetry(value => value + 1)} />}
      {data && <>
        <AlertBanner variant="warn" title="ยังต้องยืนยันกับผู้รับผิดชอบ">
          <p>รายชื่อประจำรถไม่ยืนยันว่าอยู่บนรถขณะนี้ บันทึกขึ้น–ลงเป็นข้อมูลที่กรอกไว้ในระบบ</p>
        </AlertBanner>
        <details className="rounded-xl border border-surface-border bg-surface-raised p-4 text-sm text-ink">
          <summary className="min-h-11 py-2 cursor-pointer font-semibold focus-ring rounded">ข้อมูลรถ คนขับ และวิธีอ่านข้อมูล</summary>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <div><dt className="text-ink-muted">ประเภทรถ</dt><dd className="break-words">{data.vehicle.vehicle_type || 'ยังไม่ระบุ'}</dd></div>
            <div><dt className="text-ink-muted">คนขับที่มอบหมายปัจจุบัน</dt><dd className="break-words">{data.vehicle.driver_names.length ? data.vehicle.driver_names.join(' / ') : 'ยังไม่ระบุ'}</dd></div>
            <div><dt className="text-ink-muted">จำนวนที่นั่งที่รับรอง</dt><dd>{data.vehicle.certified_capacity ?? 'ยังไม่ระบุ'}</dd></div>
          </dl>
          <p className="mt-3 leading-relaxed text-ink-muted">รายชื่อ โรงเรียน จุดรับส่งและคนขับเป็นข้อมูลที่จัดไว้ปัจจุบัน แม้เลือกดูย้อนหลัง ไม่ใช่หลักฐานผู้ขับหรือจุดขึ้น–ลงจริงในรอบนั้น ข้อมูลนี้ไม่ใช่ตำแหน่งรถปัจจุบัน การเปิดดูบันทึกประวัติทุกครั้งตามสิทธิ์เดิม</p>
        </details>
        <div className="grid grid-cols-2 gap-2" aria-label="เลือกข้อมูลที่ต้องการดู">
          {[['roster', `รายชื่อประจำรถ (${data.current_roster.length})`], ['events', `บันทึกขึ้น–ลง (${data.recorded_events.length})`]].map(([value, label]) => <button key={value} type="button"
            aria-pressed={view === value} onClick={() => setView(value)}
            className={`focus-ring min-h-12 rounded-xl border px-2 py-3 text-base font-semibold ${view === value ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-surface-border bg-surface-raised text-ink-muted'}`}>{label}</button>)}
        </div>
        <div>
          <label htmlFor="incident-name-search" className="text-sm font-semibold text-ink">ค้นชื่อนักเรียนหรือโรงเรียน</label>
          <div className="mt-2 relative">
            <Search size={18} className="absolute left-3 top-3.5 text-ink-muted" aria-hidden="true" />
            <input id="incident-name-search" type="search" value={query} onChange={event => setQuery(event.target.value)}
              placeholder="พิมพ์บางส่วนของชื่อหรือโรงเรียน" className="focus-ring min-h-12 w-full rounded-xl border border-surface-border bg-surface-raised pl-10 pr-3 text-base" />
          </div>
        </div>
        <section aria-labelledby="incident-list-title" className="space-y-3">
          <div>
            <h2 id="incident-list-title" className="text-lg font-semibold text-ink">{view === 'roster' ? 'รายชื่อประจำรถปัจจุบัน' : 'บันทึกขึ้น–ลง'} · {data.session === 'morning' ? 'รอบเช้า' : 'รอบเย็น'}</h2>
            <p className="mt-1 text-sm text-ink-muted">{view === 'roster' ? 'ข้อมูลรายชื่อที่จัดไว้ปัจจุบัน' : `${calendarLabel(data.date)} · รายการล่าสุดอยู่บนสุด ไม่ใช่จำนวนคนบนรถ`}</p>
          </div>
          <p className="text-sm text-ink-muted" role="status" aria-live="polite">พบ {rows.length} จาก {allRows.length} {view === 'roster' ? 'คน' : 'รายการ'}</p>
          {rows.length ? <IncidentPassengerCards rows={rows} events={view === 'events'} /> : <EmptyState
            title={query.trim() ? 'ไม่พบชื่อหรือโรงเรียนที่ค้นหา' : view === 'roster' ? 'ยังไม่มีรายชื่อประจำรถในรอบนี้' : 'ยังไม่พบบันทึกขึ้น–ลงในวันที่และรอบนี้'}
            description={query.trim() ? 'ลองค้นชื่อสั้นลง หรือล้างคำค้นเพื่อดูรายการทั้งหมด' : 'ยังยืนยันการขึ้นรถไม่ได้ กรุณาตรวจสอบกับผู้รับผิดชอบ'}
            action={query.trim() ? <button type="button" onClick={() => setQuery('')} className="min-h-11 px-4 text-brand-700 underline focus-ring rounded-lg">ล้างคำค้น</button> : undefined} />}
        </section>
      </>}
    </div>
  );
}
