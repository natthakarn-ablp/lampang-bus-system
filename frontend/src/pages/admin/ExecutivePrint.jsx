import { useState, useEffect, useCallback } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import api from '../../api/axios';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import { roleEvidenceMeta, describeBlockingReason, EVIDENCE_STATUS } from '../../utils/evidenceStatus';
import { snapshotPct, pctDelta, fmtSnapshotPct, fmtPctDelta } from '../../utils/kpi';

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }) : '-'; }
function fmtNow() { return new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'long', timeStyle: 'short' }); }

const METRICS = [
  { label: 'นักเรียนมีรถ', num: 'students_with_vehicle', den: 'total_students' },
  { label: 'ผู้ปกครองครบ', num: 'students_with_parent', den: 'total_students' },
  { label: 'ประกันครอบคลุม', num: 'vehicles_with_insurance', den: 'total_vehicles' },
  { label: 'ตรวจสภาพรถ', num: 'vehicles_inspected', den: 'total_vehicles' },
  { label: 'ผ่านตรวจ', num: 'vehicles_passed', den: 'total_vehicles' },
  { label: 'ส่งเช้าครบ', num: 'morning_done', den: 'morning_total' },
  { label: 'รับเย็นครบ', num: 'evening_done', den: 'evening_total' },
  { label: 'ผู้ใช้ active', num: 'active_users', den: 'total_users' },
];

const ROLES = [
  { id: 'driver', name: 'คนขับ', focus: 'ความสม่ำเสมอ + UX' },
  { id: 'school', name: 'โรงเรียน', focus: 'ข้อมูลครบถ้วน' },
  { id: 'affiliation', name: 'สังกัด', focus: 'ตรวจจับเชิงรุก' },
  { id: 'province', name: 'จังหวัด', focus: 'คุณภาพการตัดสินใจ' },
  { id: 'transport', name: 'ขนส่ง', focus: 'ปิดความเสี่ยง' },
  { id: 'admin', name: 'แอดมิน', focus: 'สุขภาพระบบ' },
];

/**
 * A printed briefing outlives the screen it came from, so the status it prints
 * has to be the one the evidence supports. The old rule promoted a role to
 * "พร้อมประเมิน" at 20 raw audit actions (audit 2026-09-04, Major 1).
 */
function roleStatus(roleCoverage) {
  return roleEvidenceMeta(roleCoverage).label;
}

export default function ExecutivePrint() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // The load error was swallowed, so a failed request printed a page that said
  // "ไม่มีข้อมูล" — an executive briefing asserting there is no evidence, when
  // the truth was that the request failed.
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/admin/evaluation-summary');
      setData(r.data?.data || null);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลสรุปผลไม่สำเร็จ');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingState message="กำลังจัดทำรายงาน…" />;
  if (error) return <ErrorState title="โหลดข้อมูลสรุปผลไม่สำเร็จ" message={error} onRetry={load} />;
  if (!data) return <EmptyState title="ไม่มีข้อมูล" description="ยังไม่มี snapshot สำหรับจัดทำรายงาน" />;

  const { baseline, latest } = data;
  // A response missing either key used to throw on the first role lookup.
  const role_actions = data.role_actions || {};
  const role_exports = data.role_exports || {};
  const bD = baseline?.data || {};
  const lD = latest?.data || {};

  const readiness = data.evidence_readiness || null;
  const roleCoverage = readiness?.roles || {};
  const freshness = readiness?.snapshot_freshness || null;
  const baselinePair = readiness?.baseline_pair || null;
  const blockingReasons = readiness?.blocking_reasons || [];

  const roleStats = ROLES.map(r => ({
    ...r,
    coverage: roleCoverage[r.id] || null,
    status: roleStatus(roleCoverage[r.id]),
    actions: role_actions[r.id]?.total || 0,
    exports: role_exports[r.id] || 0,
  }));
  const readyCount = roleStats.filter(r => r.coverage?.status === EVIDENCE_STATUS.SYSTEM_EVIDENCE).length;
  const partialCount = roleStats.filter(r => r.coverage?.status === EVIDENCE_STATUS.PARTIAL).length;

  // Same rule as the screen version and the backend export: a zero or
  // missing denominator is null, and a null delta is "cannot compare yet",
  // never 0 and never a trend.
  const metricChanges = METRICS.map(m => {
    const bv = snapshotPct(bD[m.num], bD[m.den]);
    const cv = snapshotPct(lD[m.num], lD[m.den]);
    const d = pctDelta(bv, cv);
    const comparable = d !== null;
    return { ...m, baseline: bv, current: cv, delta: d, comparable, improved: comparable && d > 0, declined: comparable && d < 0 };
  });
  const improvements = metricChanges.filter(m => m.improved);
  const risks = metricChanges.filter(m => m.declined);
  const notComparable = metricChanges.filter(m => !m.comparable);
  // `null < 50` is true in JavaScript; a metric with no denominator is not "low".
  const lowCoverage = metricChanges.filter(m => m.current !== null && m.current < 50);

  return (
    <>
      {/* Print button — hidden in print */}
      <div className="print:hidden fixed top-4 right-4 z-50 flex gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="focus-ring bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-semibold px-6 min-h-[44px] rounded-xl shadow-lg transition"
        >
          พิมพ์ / Save PDF
        </button>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="focus-ring bg-surface-border hover:bg-surface text-ink font-medium px-4 min-h-[44px] rounded-xl shadow transition"
        >
          <span aria-hidden="true">←</span> กลับ
        </button>
      </div>

      {/* Print-optimized layout */}
      <div className="max-w-[210mm] mx-auto p-6 print:p-8 bg-white print:shadow-none font-[Sarabun,sans-serif] text-[13px] leading-relaxed text-gray-800">

        {/* 1. Header */}
        <div className="border-b-4 border-blue-800 pb-3 mb-4">
          <h1 className="text-xl font-semibold text-blue-800">สรุปผลการประเมินระบบรถรับส่งนักเรียน</h1>
          <p className="text-sm text-ink-muted">ระบบรถรับส่งนักเรียนจังหวัดลำปาง — สำหรับการประชุมผู้บริหาร</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-xs text-ink-muted">
            <span>Baseline: {baseline ? fmtDate(baseline.date) : 'ยังไม่มี'}</span>
            <span>Snapshot ล่าสุด: {latest ? fmtDate(latest.date) : 'ยังไม่มี'}</span>
            <span>จัดทำเมื่อ: {fmtNow()}</span>
          </div>
        </div>

        {/* 2. Executive summary box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm">
          <p className="font-semibold text-blue-800 mb-1">สรุปสำหรับผู้บริหาร</p>
          <p>จาก 6 สิทธิ์ในระบบ มี <strong>{readyCount} สิทธิ์</strong>ที่มีหลักฐานระบบครบทุกตัวชี้วัด, <strong>{partialCount} สิทธิ์</strong>มีหลักฐานบางส่วน
            {improvements.length > 0 ? ` — มี ${improvements.length} ตัวชี้วัดที่ดีขึ้นจาก baseline` : ' — ยังไม่มีการเปลี่ยนแปลงจาก baseline (อาจเพิ่งเริ่มเก็บข้อมูล)'}
            {lowCoverage.length > 0 ? ` · ${lowCoverage.length} ตัวชี้วัดที่ยังต่ำกว่า 50%` : ''}.
          </p>
        </div>

        {/* A printed page is quoted out of context, so its limits are printed
            on it rather than left to the reader to remember. */}
        <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 mb-4 text-xs text-amber-900">
          <p className="font-semibold">ข้อจำกัดของรายงานฉบับนี้</p>
          <p className="mt-0.5">สถานะรายสิทธิ์คือความพร้อมของหลักฐานเชิงระบบ ไม่ใช่ผลการวิจัย และจำนวน action ไม่ใช่เกณฑ์ความพร้อมประเมิน</p>
          {freshness && (
            <p className="mt-0.5">
              Snapshot ล่าสุด {freshness.latest_snapshot_date || 'ยังไม่มี'}
              {freshness.age_days != null && ` อายุ ${freshness.age_days} วัน (เกณฑ์ ${freshness.max_age_days} วัน)`}
              {freshness.fresh ? '' : ' — เก่าเกินเกณฑ์ ตัวเลขในรายงานอธิบายวันที่เก็บ ไม่ใช่สถานะปัจจุบัน'}
            </p>
          )}
          {baselinePair && !baselinePair.usable && (
            <p className="mt-0.5">ห้ามตีความคอลัมน์ “เปลี่ยนแปลง” เป็นผลการวิจัย: {describeBlockingReason(baselinePair.reason)}</p>
          )}
          {blockingReasons.length > 0 && (
            <p className="mt-0.5">ยังอ้างผลวิจัยไม่ได้ เพราะ: {blockingReasons.map(describeBlockingReason).join(' · ')}</p>
          )}
        </div>

        {/* 3. KPI strip */}
        <div className="grid grid-cols-6 gap-2 mb-4">
          <KpiCell label="หลักฐานระบบครบ" value={readyCount} />
          <KpiCell label="บางส่วน" value={partialCount} />
          <KpiCell label="ยังต้องเพิ่ม" value={6 - readyCount - partialCount} />
          <KpiCell label="ดีขึ้น" value={improvements.length} />
          <KpiCell label="ลดลง" value={risks.length} />
          <KpiCell label="ต่ำ (<50%)" value={lowCoverage.length} />
        </div>

        {/* 4. Role readiness table */}
        <div className="mb-4">
          <p className="font-semibold text-sm text-gray-700 mb-1">สถานะความพร้อมรายสิทธิ์</p>
          <table className="w-full text-xs border border-gray-300">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 px-2 py-1 text-left">สิทธิ์</th>
                <th className="border border-gray-300 px-2 py-1 text-left">เน้นวัด</th>
                <th className="border border-gray-300 px-2 py-1 text-center">สถานะหลักฐาน</th>
                <th className="border border-gray-300 px-2 py-1 text-center">ตัวชี้วัดที่มีหลักฐานครบ</th>
                <th className="border border-gray-300 px-2 py-1 text-center">Actions (ปริมาณใช้งาน)</th>
                <th className="border border-gray-300 px-2 py-1 text-center">Exports</th>
              </tr>
            </thead>
            <tbody>
              {roleStats.map(r => (
                <tr key={r.id}>
                  <td className="border border-gray-300 px-2 py-1 font-medium">{r.name}</td>
                  <td className="border border-gray-300 px-2 py-1 text-gray-600">{r.focus}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center">{r.status}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center">
                    {r.coverage ? `${r.coverage.system_evidence}/${r.coverage.metric_total}` : '-'}
                  </td>
                  <td className="border border-gray-300 px-2 py-1 text-center">{r.actions}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center">{r.exports}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 5. Metric comparison table */}
        <div className="mb-4">
          <p className="font-semibold text-sm text-gray-700 mb-1">ตัวชี้วัดหลัก — Baseline เทียบปัจจุบัน</p>
          <table className="w-full text-xs border border-gray-300">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 px-2 py-1 text-left">ตัวชี้วัด</th>
                <th className="border border-gray-300 px-2 py-1 text-center">Baseline</th>
                <th className="border border-gray-300 px-2 py-1 text-center">ปัจจุบัน</th>
                <th className="border border-gray-300 px-2 py-1 text-center">เปลี่ยนแปลง</th>
                <th className="border border-gray-300 px-2 py-1 text-center">แนวโน้ม</th>
              </tr>
            </thead>
            <tbody>
              {metricChanges.map(m => (
                <tr key={m.label}>
                  <td className="border border-gray-300 px-2 py-1">{m.label}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center">{fmtSnapshotPct(m.baseline)}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center font-medium">{fmtSnapshotPct(m.current)}</td>
                  <td className="border border-gray-300 px-2 py-1 text-center">
                    {fmtPctDelta(m.delta)}
                  </td>
                  <td className="border border-gray-300 px-2 py-1 text-center">
                    {m.comparable ? (
                      <>
                        <span aria-hidden="true">{m.improved ? '▲' : m.declined ? '▼' : '='}</span>
                        {' '}{m.improved ? 'ดีขึ้น' : m.declined ? 'ลดลง' : 'คงเดิม'}
                      </>
                    ) : <span className="text-ink-muted">ไม่มีข้อมูล</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 6+7. Improvements + Risks side by side */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="border border-gray-300 rounded-lg p-3">
            <p className="font-semibold text-sm text-success-ink mb-1 inline-flex items-center gap-1.5">
              <Check className="w-4 h-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              ประเด็นที่ดีขึ้น
            </p>
            {improvements.length > 0 ? (
              <ul className="text-xs space-y-0.5">
                {improvements.map(m => <li key={m.label}>• {m.label}: {fmtPctDelta(m.delta)}</li>)}
              </ul>
            ) : <p className="text-xs text-ink-muted">ยังไม่มีการเปลี่ยนแปลงจาก baseline</p>}
          </div>
          <div className="border border-gray-300 rounded-lg p-3">
            <p className="font-semibold text-sm text-danger-ink mb-1 inline-flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              ประเด็นที่ต้องติดตาม
            </p>
            <ul className="text-xs space-y-0.5">
              {risks.map(m => <li key={m.label}>• {m.label}: {fmtPctDelta(m.delta)}</li>)}
              {lowCoverage.map(m => <li key={`l-${m.label}`}>• {m.label} ยังต่ำ: {fmtSnapshotPct(m.current)}</li>)}
              {risks.length === 0 && lowCoverage.length === 0 && <li className="text-ink-muted">ไม่พบจุดเสี่ยงจากข้อมูลปัจจุบัน</li>}
              {notComparable.length > 0 && <li className="text-ink-muted">• ยังเทียบไม่ได้ (ตัวส่วนเป็น 0 หรือไม่มีข้อมูล): {notComparable.map(m => m.label).join(', ')}</li>}
            </ul>
          </div>
        </div>

        {/* 8. Recommended actions */}
        <div className="border border-blue-300 bg-blue-50 rounded-lg p-3 mb-4">
          <p className="font-semibold text-sm text-blue-800 mb-1">ข้อเสนอเพื่อการสั่งการ</p>
          <ul className="text-xs text-blue-700 space-y-0.5">
            {(6 - readyCount - partialCount) > 0 && <li>• เพิ่มการเก็บ evidence สำหรับ {6 - readyCount - partialCount} สิทธิ์ที่ยังมีข้อมูลไม่เพียงพอ</li>}
            {lowCoverage.length > 0 && <li>• เร่งเพิ่ม coverage ใน: {lowCoverage.map(m => m.label).join(', ')}</li>}
            {risks.length > 0 && <li>• ตรวจสอบ metric ที่ลดลง: {risks.map(m => m.label).join(', ')}</li>}
            {partialCount > 0 && <li>• ให้ {partialCount} สิทธิ์ที่ประเมินได้บางส่วนเพิ่มการใช้งานระบบ</li>}
            <li>• ให้รัน snapshot ใหม่เป็นประจำเพื่อเห็นแนวโน้มการเปลี่ยนแปลง</li>
          </ul>
        </div>

        {/* Footer */}
        <div className="border-t-2 border-gray-300 pt-3 mt-4 text-xs text-ink-muted">
          <p><strong>หมายเหตุ:</strong> รายงานนี้สรุปจาก snapshot, logs และ export evidence ในระบบ — บางตัวชี้วัดยังต้องใช้หลักฐานภายนอก (แบบสอบถาม, สัมภาษณ์, บันทึกประชุม) ร่วมด้วยจึงจะประเมินได้ครบถ้วน</p>
          <div className="flex justify-between mt-4">
            <div>
              <p className="text-ink-muted">ผู้จัดทำ: .......................................</p>
              <p className="text-ink-muted mt-3">ผู้ตรวจสอบ: .......................................</p>
            </div>
            <div className="text-right">
              <p>ระบบรถรับส่งนักเรียนจังหวัดลำปาง</p>
              <p>{fmtNow()}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { margin: 0; padding: 0; font-family: 'Sarabun', sans-serif; }
          .print\\:hidden { display: none !important; }
          .print\\:p-8 { padding: 8mm !important; }
          .print\\:shadow-none { box-shadow: none !important; }
          @page { size: A4 portrait; margin: 10mm; }
        }
      `}</style>
    </>
  );
}

function KpiCell({ label, value }) {
  return (
    <div className="border border-gray-300 rounded p-2 text-center">
      <p className="text-lg font-semibold text-gray-800">{value}</p>
      <p className="text-[10px] text-ink-muted">{label}</p>
    </div>
  );
}
