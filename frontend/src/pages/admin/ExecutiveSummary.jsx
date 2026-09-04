import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import { roleEvidenceMeta, describeBlockingReason, EVIDENCE_STATUS } from '../../utils/evidenceStatus';

function pct(n, d) { return d > 0 ? Math.round((n / d) * 10000) / 100 : 0; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'; }

const METRICS = [
  { key: 'vehicle_assign', label: 'นักเรียนมีรถ', num: 'students_with_vehicle', den: 'total_students', higher: true },
  { key: 'parent', label: 'ผู้ปกครองครบ', num: 'students_with_parent', den: 'total_students', higher: true },
  { key: 'insurance', label: 'ประกันครอบคลุม', num: 'vehicles_with_insurance', den: 'total_vehicles', higher: true },
  { key: 'inspected', label: 'ตรวจสภาพรถ', num: 'vehicles_inspected', den: 'total_vehicles', higher: true },
  { key: 'passed', label: 'ผ่านตรวจ', num: 'vehicles_passed', den: 'total_vehicles', higher: true },
  { key: 'morning', label: 'ส่งเช้าครบ', num: 'morning_done', den: 'morning_total', higher: true },
  { key: 'evening', label: 'รับเย็นครบ', num: 'evening_done', den: 'evening_total', higher: true },
  { key: 'active', label: 'ผู้ใช้ active', num: 'active_users', den: 'total_users', higher: true },
];

const ROLES = [
  { id: 'driver', code: 'DR', name: 'คนขับ', color: 'bg-orange-500' },
  { id: 'school', code: 'SC', name: 'โรงเรียน', color: 'bg-green-600' },
  { id: 'affiliation', code: 'AF', name: 'สังกัด', color: 'bg-teal-600' },
  { id: 'province', code: 'PR', name: 'จังหวัด', color: 'bg-blue-600' },
  { id: 'transport', code: 'TR', name: 'ขนส่ง', color: 'bg-indigo-600' },
  { id: 'admin', code: 'AD', name: 'แอดมิน', color: 'bg-purple-600' },
];

/**
 * Status comes from server-computed metric coverage. The previous rule awarded
 * "พร้อมประเมิน" at 20 raw audit actions, so login and import volume could
 * make a role look evaluable (audit 2026-09-04, Major 1).
 */
function roleStatus(roleCoverage) {
  return roleEvidenceMeta(roleCoverage);
}

export default function ExecutiveSummary() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/evaluation-summary')
      .then(r => setData(r.data?.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (!data) return <EmptyState title="ยังไม่มีข้อมูล" />;

  const { baseline, latest, role_actions, role_exports } = data;
  const bD = baseline?.data || {};
  const lD = latest?.data || {};

  const readiness = data.evidence_readiness || null;
  const roleCoverage = readiness?.roles || {};
  const freshness = readiness?.snapshot_freshness || null;
  const blockingReasons = readiness?.blocking_reasons || [];

  // Compute role readiness from evidence coverage, not action volume.
  const roleStats = ROLES.map(r => ({
    ...r,
    actions: role_actions[r.id] || { total: 0 },
    exports: role_exports[r.id] || 0,
    coverage: roleCoverage[r.id] || null,
    status: roleStatus(roleCoverage[r.id]),
  }));
  const readyCount = roleStats.filter(r => r.coverage?.status === EVIDENCE_STATUS.SYSTEM_EVIDENCE).length;
  const partialCount = roleStats.filter(r => r.coverage?.status === EVIDENCE_STATUS.PARTIAL).length;
  const missingCount = roleStats.length - readyCount - partialCount;

  // Compute metric changes
  const metricChanges = METRICS.map(m => {
    const bv = pct(bD[m.num] || 0, bD[m.den] || 0);
    const cv = pct(lD[m.num] || 0, lD[m.den] || 0);
    const d = Math.round((cv - bv) * 100) / 100;
    const improved = m.higher ? d > 0 : d < 0;
    const declined = m.higher ? d < 0 : d > 0;
    return { ...m, baseline: bv, current: cv, delta: d, improved, declined };
  });
  const improvements = metricChanges.filter(m => m.improved);
  const risks = metricChanges.filter(m => m.declined);
  const lowCoverage = metricChanges.filter(m => m.current < 50);

  // Total actions
  const totalActions = Object.values(role_actions).reduce((s, r) => s + (r.total || 0), 0);

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto pb-10">
      {/* Header */}
      <div className="bg-navy-700 text-white rounded-xl px-5 py-5 mb-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-caption text-navy-200 uppercase tracking-wider">Executive Summary</p>
            <h1 className="text-xl font-semibold mt-1">สรุปภาพรวมการประเมินระบบ</h1>
            <p className="text-sm text-navy-200 mt-1">Baseline • Current • Role Readiness • Key Risks</p>
          </div>
          <button onClick={() => navigate('/admin/executive-print')}
            className="focus-ring-inverse inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white text-sm font-medium px-4 min-h-[44px] rounded-lg transition shrink-0">
            พิมพ์รายงาน
          </button>
        </div>
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-blue-200">
          <span>Baseline: {baseline ? fmtDate(baseline.date) : 'ยังไม่มี'}</span>
          <span>Snapshot ล่าสุด: {latest ? fmtDate(latest.date) : 'ยังไม่มี'}</span>
          <span>Actions ทั้งหมด: {totalActions}</span>
        </div>
      </div>

      {/* A summary that leads with readiness has to say what readiness means
          here, and what it still cannot claim. */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-sm text-amber-900">
        <p className="font-semibold">สถานะนี้เป็นความพร้อมของหลักฐาน ไม่ใช่ผลการวิจัย</p>
        <p className="mt-1">จำนวน action ไม่ใช่เกณฑ์ความพร้อมประเมิน สถานะรายสิทธิ์คำนวณจากความครอบคลุมของตัวชี้วัดที่มีหลักฐานจริง</p>
        {freshness && (
          <p className="mt-1">
            Snapshot ล่าสุด {freshness.latest_snapshot_date || 'ยังไม่มี'}
            {freshness.age_days != null && ` (อายุ ${freshness.age_days} วัน, เกณฑ์ ${freshness.max_age_days} วัน)`}
            {freshness.fresh ? ' — อยู่ในเกณฑ์' : ' — เก่าเกินเกณฑ์'}
          </p>
        )}
        {blockingReasons.length > 0 && (
          <p className="mt-1">ยังอ้างผลวิจัยไม่ได้ เพราะ: {blockingReasons.map(describeBlockingReason).join(' · ')}</p>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-5">
        <MiniKpi label="หลักฐานระบบครบ" value={readyCount} color="green" />
        <MiniKpi label="บางส่วน" value={partialCount} color="amber" />
        <MiniKpi label="ยังต้องเพิ่ม" value={missingCount} color="red" />
        <MiniKpi label="ดีขึ้น" value={improvements.length} color="green" />
        <MiniKpi label="ลดลง" value={risks.length} color={risks.length > 0 ? 'red' : 'green'} />
        <MiniKpi label="ต่ำ (<50%)" value={lowCoverage.length} color={lowCoverage.length > 0 ? 'amber' : 'green'} />
      </div>

      {/* Role readiness */}
      <section className="mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">สถานะความพร้อมรายสิทธิ์</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {roleStats.map(r => (
            <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold ${r.color}`}>{r.code}</span>
                <span className="font-semibold text-gray-800 text-sm">{r.name}</span>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.status.cls}`}>{r.status.label}</span>
              <p className="text-xs text-gray-400 mt-1">
                หลักฐานครบ {r.coverage ? `${r.coverage.system_evidence}/${r.coverage.metric_total}` : '-'} ตัวชี้วัด ·
                {' '}{r.actions.total} actions (ปริมาณการใช้งาน) · {r.exports} exports
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Improvements + Risks side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        {/* Improvements */}
        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-green-800 mb-2">สิ่งที่ดีขึ้นจาก Baseline</h2>
          {improvements.length > 0 ? (
            <ul className="space-y-1">
              {improvements.map(m => (
                <li key={m.key} className="text-sm text-green-700">
                  <strong>{m.label}</strong>: {m.baseline}% → {m.current}% <span className="font-semibold"><span aria-hidden="true">▲</span> +{m.delta}%</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-green-600">ยังไม่มีการเปลี่ยนแปลงจาก baseline (อาจเพิ่งเริ่มเก็บข้อมูล)</p>
          )}
        </div>

        {/* Risks */}
        <div className={`border rounded-xl p-4 ${risks.length > 0 || lowCoverage.length > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
          <h2 className={`text-sm font-semibold mb-2 ${risks.length > 0 ? 'text-red-800' : 'text-gray-700'}`}>
            {risks.length > 0 ? 'จุดเสี่ยง / ต้องติดตาม' : 'ไม่มีจุดเสี่ยงจากข้อมูลปัจจุบัน'}
          </h2>
          <ul className="space-y-1">
            {risks.map(m => (
              <li key={m.key} className="text-sm text-red-700">
                <strong>{m.label}</strong>: {m.baseline}% → {m.current}% <span className="font-semibold"><span aria-hidden="true">▼</span> {m.delta}%</span>
              </li>
            ))}
            {lowCoverage.map(m => (
              <li key={`low-${m.key}`} className="text-sm text-amber-700">
                <strong>{m.label}</strong> ยังต่ำ: {m.current}%
              </li>
            ))}
            {risks.length === 0 && lowCoverage.length === 0 && (
              <li className="text-sm text-gray-500">ไม่พบ metric ที่ลดลงหรือต่ำกว่า 50%</li>
            )}
          </ul>
        </div>
      </div>

      {/* Recommended actions */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5">
        <h2 className="text-sm font-semibold text-blue-800 mb-2">สิ่งที่ควรดำเนินการต่อ</h2>
        <ul className="space-y-1.5 text-sm text-blue-700">
          {missingCount > 0 && (
            <li>• เพิ่มการเก็บ evidence สำหรับ <strong>{missingCount} role</strong> ที่ยังมีข้อมูลไม่เพียงพอ</li>
          )}
          {lowCoverage.length > 0 && (
            <li>• เร่งเพิ่ม coverage ใน: <strong>{lowCoverage.map(m => m.label).join(', ')}</strong></li>
          )}
          {risks.length > 0 && (
            <li>• ตรวจสอบ metric ที่ลดลง: <strong>{risks.map(m => m.label).join(', ')}</strong></li>
          )}
          {partialCount > 0 && (
            <li>• ให้ <strong>{partialCount} role</strong> ที่ประเมินได้บางส่วนเพิ่มการใช้งานระบบเพื่อเก็บ log เพิ่มเติม</li>
          )}
          {improvements.length === 0 && risks.length === 0 && (
            <li>• ให้รัน snapshot ใหม่หลังจากระบบถูกใช้งานระยะหนึ่ง เพื่อเห็นแนวโน้มการเปลี่ยนแปลง</li>
          )}
          <li>• ดูรายละเอียดแยก role ที่ <strong>"ประเมินผลแยก Role"</strong></li>
          <li>• ส่งออกชุดข้อมูลวิจัยที่ <strong>"ส่งออกข้อมูลวิจัย"</strong></li>
        </ul>
      </div>

      {/* Evidence honesty note */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-xs text-gray-500">
        <p><strong>หมายเหตุ:</strong> การประเมินนี้ใช้ข้อมูลจากระบบ (snapshot, audit logs, export evidence) เป็นหลัก — บาง metric ของบาง role ต้องใช้หลักฐานภายนอก (แบบสอบถาม, สัมภาษณ์, บันทึกประชุม) ร่วมด้วย จึงจะประเมินได้ครบถ้วน</p>
      </div>
    </div>
  );
}

function MiniKpi({ label, value, color }) {
  const bg = { green: 'bg-green-50 text-green-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-700', gray: 'bg-gray-50 text-gray-600' };
  return (
    <div className={`rounded-lg p-2 text-center ${bg[color] || bg.gray}`}>
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs">{label}</p>
    </div>
  );
}
