import { useState, useEffect, useCallback, useRef } from 'react';
import { FileBarChart, Bus, GraduationCap } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../hooks/useAuth';
import ExportButtons from '../../components/ExportButtons';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { StatusBadge, DataTable, FormField } from '../../components/ui';
import { StatusHero, ActionList, StatTile, StatGrid, TravelLeaveSummary, roundStatus } from '../../components/dashboard';
import { ReportHero, ReportSection, ExportPanel, reportScopeName } from './ReportParts';

// Where each role acts on a follow-up item (admin has no such page).
const ROLE_LINKS = {
  school: { round: '/school/teacher-check', emergency: '/school/emergencies' },
  affiliation: { round: '/affiliation/status', emergency: '/affiliation/emergencies' },
  province: { round: '/province/status', emergency: '/province/emergencies' },
};

export default function DailyReport() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showDecision, setShowDecision] = useState(false);
  const decisionResolveRef = useRef(null);
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
  );

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/reports/daily?date=${date}`);
      setData(res.data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const thaiDate = date ? new Date(date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }) : '';
  // One calm, time-aware status per round. `date` is the report date, so an
  // earlier day with gaps reads amber and a round that has not opened is grey.
  const morning = data ? roundStatus({ session: 'morning', done: data.morning_done, expected: data.morning_total, date, conflict: data.morning_conflict }) : null;
  const evening = data ? roundStatus({ session: 'evening', done: data.evening_done, expected: data.evening_total, date, conflict: data.evening_conflict }) : null;
  const emergencies = Number(data?.emergency_count) || 0;
  const links = ROLE_LINKS[user?.role] || {};
  const isToday = date === new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <ReportHero eyebrow="รายงานรายวัน" title={reportScopeName(user, data)} subtitle={thaiDate}>
        <FormField label="วันที่ของรายงาน" labelClassName="text-navy-200" className="sm:w-48">
          {ctl => (
            <input {...ctl} type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="focus-ring-inverse w-full border border-navy-500 bg-navy-600 text-white rounded-lg px-3 min-h-[44px] text-base sm:text-sm" />
          )}
        </FormField>
      </ReportHero>

      {error && <ErrorState message={error} className="mb-4" />}

      {loading ? (
        <LoadingState />
      ) : error ? null : !data ? (
        <EmptyState icon={FileBarChart} title="ไม่มีข้อมูล" description="ลองเปลี่ยนวันที่หรือช่วงเวลาอื่น" />
      ) : (
        <>
          {/* ── 1. Answer first: status per round ── */}
          <StatusHero
            className="mb-5"
            emergencies={emergencies}
            rounds={[{ status: morning }, { status: evening }]}
          />

          {/* ── 2. What to follow up ── */}
          <ActionList
            className="mb-5"
            title="จุดที่ต้องติดตาม"
            hideWhenEmpty
            items={[
              { key: 'em', tone: 'danger', count: emergencies, title: `เหตุฉุกเฉิน ${emergencies} รายการ`, sub: 'ดูรายละเอียดและติดตามผล', to: links.emergency, actionLabel: 'ดูเหตุฉุกเฉิน' },
              { key: 'm', tone: morning.tone, count: ['not_delivered', 'overdue', 'incomplete_record'].includes(morning.state) ? morning.pending : 0, title: `รอบเช้ายังไม่ยืนยัน ${morning.pending} คน`, sub: morning.detail },
              { key: 'e', tone: evening.tone, count: ['not_delivered', 'overdue', 'incomplete_record'].includes(evening.state) ? evening.pending : 0, title: `รอบเย็นยังไม่ยืนยัน ${evening.pending} คน`, sub: evening.detail },
            ].map(i => (i.key === 'em' || !isToday ? i : { ...i, to: links.round, actionLabel: 'ดูรายชื่อ' }))}
          />

          {/* ── 3. Totals ── */}
          <StatGrid cols={2} label="จำนวนรถและนักเรียน" className="mb-5">
            <StatTile icon={Bus} label="รถรับส่ง" value={data.total_vehicles} unit="คัน" />
            <StatTile icon={GraduationCap} label="นักเรียนที่ใช้รถ" value={data.total_students} unit="คน" />
          </StatGrid>

          {/* Self-travel / leave: in context under the round totals, hidden when all 0. */}
          <TravelLeaveSummary data={data} className="mb-5" />

          {/* ── สรุปรายโรงเรียน ── */}
          {data.schools?.length > 0 && (
            <ReportSection title="สรุปรายโรงเรียน" hint="ส่งเช้า / รับเย็น แสดงเป็น จำนวนที่ยืนยันแล้ว / จำนวนที่ใช้รถ">
              <CompletionTable
                caption="สรุปการรับ-ส่งรายโรงเรียน"
                rows={data.schools}
                rowKey={s => s.school_id}
                labelHeader="โรงเรียน"
                label={s => s.school_name}
              />
            </ReportSection>
          )}

          {/* ── สรุปรายรถ ── */}
          {data.vehicles?.length > 0 && (
            <ReportSection title="สรุปรายรถ">
              <CompletionTable
                caption="สรุปการรับ-ส่งรายรถ"
                rows={data.vehicles}
                rowKey={v => v.vehicle_id}
                labelHeader="ทะเบียนรถ"
                label={v => v.plate_no}
              />
            </ReportSection>
          )}

          {/* ── Export ── */}
          <ExportPanel note={`ข้อมูลของ${thaiDate} · CSV และ Excel เปิดในตารางคำนวณ, PDF สำหรับพิมพ์`}>
            <ExportButtons queryParams={`date=${date}`} filenamePrefix={`report-${date}`}
              onBeforeExport={user?.role === 'province' ? (fmt) => new Promise((resolve, reject) => {
                if (fmt !== 'pdf') { resolve(); return; }
                decisionResolveRef.current = { resolve, reject };
                setShowDecision(true);
              }) : undefined}
            />
          </ExportPanel>
        </>
      )}

      {/* Province Decision Log Modal */}
      {showDecision && <DecisionLogModal
        onSubmit={async (decisionType, decisionNote) => {
          if (decisionType || decisionNote) {
            try {
              await api.post('/reports/decision-log', { decision_type: decisionType, decision_note: decisionNote, report_type: 'daily', report_date: date });
            } catch {}
          }
          setShowDecision(false);
          decisionResolveRef.current?.resolve();
        }}
        onSkip={() => { setShowDecision(false); decisionResolveRef.current?.resolve(); }}
        onCancel={() => { setShowDecision(false); decisionResolveRef.current?.reject(); }}
      />}
    </div>
  );
}

function DecisionLogModal({ onSubmit, onSkip, onCancel }) {
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  const TYPES = [
    { value: 'follow_up', label: 'ติดตามผล' },
    { value: 'action_needed', label: 'ต้องดำเนินการ' },
    { value: 'info_only', label: 'รับทราบ' },
    { value: 'escalate', label: 'ส่งต่อผู้บังคับบัญชา' },
  ];
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-surface-raised border border-surface-border rounded-2xl shadow-elevate max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">บันทึกการตัดสินใจ</h3>
        <p className="text-sm text-ink-muted mb-4">บันทึกสั้นๆ ก่อนดาวน์โหลด PDF (ไม่บังคับ)</p>
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">ประเภทการตัดสินใจ</label>
          <div className="flex flex-wrap gap-2">
            {TYPES.map(t => (
              <button key={t.value} onClick={() => setType(t.value)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition ${type === t.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">หมายเหตุ</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="เช่น จะประสานเรื่อง..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 text-sm text-ink-muted border border-gray-200 py-2 rounded-lg hover:bg-gray-50">ยกเลิก</button>
          <button onClick={onSkip} className="flex-1 text-sm text-gray-600 border border-gray-200 py-2 rounded-lg hover:bg-gray-50">ข้าม</button>
          <button onClick={() => onSubmit(type, note)} className="flex-1 text-sm bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 font-medium">บันทึก + ดาวน์โหลด</button>
        </div>
      </div>
    </div>
  );
}

/**
 * CompletionTable — the daily report's two summary tables (per school, per
 * vehicle) are the same table with a different label column, so they are one
 * component here rather than two near-identical blocks.
 *
 * The done/total cells used green-vs-amber text alone to say whether a session
 * was complete. The status column already carries that as a word, so the counts
 * stay neutral and the badge does the signalling.
 */
function CompletionTable({ caption, rows, rowKey, labelHeader, label }) {
  const done = (d, total) => `${d}/${total}`;
  // Each session is measured against the pupils who use it, the same
  // denominator as the tiles above. Dividing by every pupil marked a school
  // "ค้าง" whenever one child rode only one way, while the tiles said "ครบ".
  // student_count is the fallback for a server that predates the fields.
  const mExp = r => r.morning_expected ?? r.student_count;
  const eExp = r => r.evening_expected ?? r.student_count;
  return (
    <DataTable
      caption={caption}
      rows={rows}
      rowKey={rowKey}
      columns={[
        { key: 'label', header: labelHeader, primary: true,
          cell: r => <span className="font-medium text-ink">{label(r)}</span> },
        { key: 'students', header: 'นักเรียน', numeric: true, cell: r => r.student_count },
        { key: 'morning', header: 'ส่งเช้า', numeric: true, cell: r => done(r.morning_done, mExp(r)) },
        { key: 'evening', header: 'รับเย็น', numeric: true, cell: r => done(r.evening_done, eExp(r)) },
        { key: 'status', header: 'สถานะ', align: 'center', badge: true,
          cell: r => {
            if (r.morning_conflict || r.evening_conflict) return <StatusBadge variant="danger">ข้อมูลขัดกัน</StatusBadge>;
            if (!mExp(r) && !eExp(r)) return <StatusBadge variant="neutral">ไม่ใช้รถ</StatusBadge>;
            const ok = r.morning_done >= mExp(r) && r.evening_done >= eExp(r);
            return <StatusBadge variant={ok ? 'success' : 'warn'}>{ok ? 'ครบ' : 'ค้าง'}</StatusBadge>;
          } },
      ]}
      empty={{ title: 'ไม่มีข้อมูลในวันที่เลือก' }}
    />
  );
}
