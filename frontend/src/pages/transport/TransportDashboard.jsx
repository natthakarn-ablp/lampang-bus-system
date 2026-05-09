import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/axios';
import { DonutChart } from '../../components/MiniCharts';

// SLA configuration — days allowed to resolve a risk item
const SLA_DAYS = 7;

function formatThaiDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Compute SLA deadline and remaining days for a risk item */
function slaInfo(v) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const insp = v.latest_inspection_result;

  // Determine the "risk start date" for SLA calculation
  let riskStart = null;
  let reason = '';

  if (insp === 'FAILED') {
    riskStart = v.latest_inspection_date ? new Date(v.latest_inspection_date) : null;
    reason = 'ตั้งแต่วันที่ไม่ผ่านตรวจ';
  } else if (insp === 'NEEDS_FIX') {
    riskStart = v.latest_inspection_date ? new Date(v.latest_inspection_date) : null;
    reason = 'ตั้งแต่วันที่ต้องแก้ไข';
  } else if (!insp) {
    // Never inspected — use vehicle creation date or fallback to 30 days ago
    riskStart = v.created_at ? new Date(v.created_at) : new Date(now.getTime() - 30 * 86400000);
    reason = 'ยังไม่เคยตรวจ';
  } else if (v.insurance_expiry && new Date(v.insurance_expiry) < now) {
    riskStart = new Date(v.insurance_expiry);
    reason = 'ตั้งแต่ประกันหมด';
  }

  if (!riskStart) return null;
  riskStart.setHours(0, 0, 0, 0);

  const deadline = new Date(riskStart.getTime() + SLA_DAYS * 86400000);
  const daysLeft = Math.ceil((deadline - now) / 86400000);
  const overdue = daysLeft < 0;

  let color = 'text-green-600 bg-green-50 border-green-200';
  if (daysLeft <= 0) color = 'text-red-800 bg-red-100 border-red-300 font-bold';
  else if (daysLeft <= 2) color = 'text-red-600 bg-red-50 border-red-200';
  else if (daysLeft <= 5) color = 'text-amber-700 bg-amber-50 border-amber-200';

  return { deadline, daysLeft, overdue, color, reason };
}

function riskScore(v) {
  let score = 0;
  const insp = v.latest_inspection_result;
  const hasIns = v.insurance_expiry != null;
  const insExpired = hasIns && new Date(v.insurance_expiry) < new Date();
  const insExpiring = hasIns && !insExpired && new Date(v.insurance_expiry) < new Date(Date.now() + 30*86400000);
  if (insp === 'FAILED') score += 100;
  if (!insp) score += 80;
  if (insp === 'NEEDS_FIX') score += 60;
  if (insExpired) score += 50;
  if (!hasIns) score += 40;
  if (insExpiring) score += 20;
  return score;
}

function riskTags(v) {
  const tags = [];
  const insp = v.latest_inspection_result;
  if (insp === 'FAILED') tags.push({ text: 'ไม่ผ่านตรวจ', cls: 'bg-red-600 text-white' });
  else if (!insp) tags.push({ text: 'ยังไม่ตรวจ', cls: 'bg-red-100 text-red-700 border border-red-200' });
  else if (insp === 'NEEDS_FIX') tags.push({ text: 'ต้องแก้ไข', cls: 'bg-yellow-100 text-yellow-800 border border-yellow-200' });
  const hasIns = v.insurance_expiry != null;
  if (hasIns && new Date(v.insurance_expiry) < new Date()) tags.push({ text: 'ประกันหมด', cls: 'bg-red-600 text-white' });
  else if (!hasIns) tags.push({ text: 'ไม่มีข้อมูลประกัน', cls: 'bg-gray-200 text-gray-700' });
  else if (new Date(v.insurance_expiry) < new Date(Date.now() + 30*86400000)) tags.push({ text: 'ประกันใกล้หมด', cls: 'bg-yellow-100 text-yellow-800 border border-yellow-200' });
  return tags;
}

function suggestion(v) {
  const insp = v.latest_inspection_result;
  if (insp === 'FAILED') return 'ควรตรวจซ้ำ/แก้ไขทันที';
  if (!insp) return 'ควรบันทึกผลตรวจ';
  if (insp === 'NEEDS_FIX') return 'ควรแก้ไขแล้วตรวจซ้ำ';
  const hasIns = v.insurance_expiry != null;
  if (hasIns && new Date(v.insurance_expiry) < new Date()) return 'ควรต่อประกัน';
  if (!hasIns) return 'ควรกรอกข้อมูลประกัน';
  if (hasIns && new Date(v.insurance_expiry) < new Date(Date.now() + 30*86400000)) return 'ประกันใกล้หมด ควรต่อล่วงหน้า';
  return null;
}

function priorityLevel(score) {
  if (score >= 100) return { text: 'เร่งด่วน', cls: 'bg-red-600 text-white' };
  if (score >= 60) return { text: 'ต้องติดตาม', cls: 'bg-amber-500 text-white' };
  if (score >= 20) return { text: 'ข้อมูลไม่ครบ', cls: 'bg-gray-400 text-white' };
  return { text: 'พร้อมใช้งาน', cls: 'bg-green-600 text-white' };
}

// Filter definitions
const FILTERS = [
  { key: 'all', label: 'ทั้งหมด', fn: () => true },
  { key: 'urgent', label: 'เร่งด่วน', fn: v => riskScore(v) >= 100 },
  { key: 'not_inspected', label: 'ยังไม่ตรวจ', fn: v => !v.latest_inspection_result },
  { key: 'failed', label: 'ไม่ผ่าน', fn: v => v.latest_inspection_result === 'FAILED' },
  { key: 'needs_fix', label: 'ต้องแก้ไข', fn: v => v.latest_inspection_result === 'NEEDS_FIX' },
  { key: 'ins_expired', label: 'ประกันหมด', fn: v => v.insurance_expiry && new Date(v.insurance_expiry) < new Date() },
  { key: 'no_ins', label: 'ไม่มีข้อมูลประกัน', fn: v => !v.insurance_expiry },
  { key: 'ins_expiring', label: 'ใกล้หมดอายุ', fn: v => v.insurance_expiry && new Date(v.insurance_expiry) >= new Date() && new Date(v.insurance_expiry) < new Date(Date.now() + 30*86400000) },
  { key: 'ready', label: 'พร้อมใช้งาน', fn: v => riskScore(v) === 0 },
];

export default function TransportDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const savedParam = searchParams.get('saved') || '';
  const [highlightId, setHighlightId] = useState(savedParam);
  const highlightRef = useRef(null);

  const [data, setData] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [vSearch, setVSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');

  useEffect(() => {
    Promise.all([
      api.get('/transport/dashboard').then(r => r.data.data),
      api.get('/transport/vehicles?per_page=200').then(r => r.data.data).catch(() => []),
    ])
      .then(([dash, vList]) => { setData(dash); setVehicles(vList || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Auto-scroll to highlighted vehicle + auto-clear after 6 seconds
  useEffect(() => {
    if (highlightId && !loading && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (highlightId && !loading) {
      const timer = setTimeout(() => {
        setHighlightId('');
        if (searchParams.has('saved')) setSearchParams({}, { replace: true });
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [highlightId, loading]);

  // Filter counts
  const filterCounts = useMemo(() => {
    const counts = {};
    FILTERS.forEach(f => { counts[f.key] = vehicles.filter(f.fn).length; });
    return counts;
  }, [vehicles]);

  // Apply active filter + search
  const currentFilter = FILTERS.find(f => f.key === activeFilter) || FILTERS[0];
  const filtered = useMemo(() => {
    let list = vehicles.filter(currentFilter.fn);
    if (vSearch) list = list.filter(v => v.plate_no?.toLowerCase().includes(vSearch.toLowerCase()));
    return list.map(v => ({ ...v, _score: riskScore(v) })).sort((a, b) => b._score - a._score);
  }, [vehicles, activeFilter, vSearch, currentFilter]);

  if (loading) return <p className="text-gray-400 py-10 text-center text-lg">กำลังโหลด…</p>;
  if (!data) return <p className="text-gray-400 py-10 text-center text-lg">ไม่มีข้อมูล</p>;

  const urgentCount = vehicles.filter(v => riskScore(v) >= 100).length;
  const readyCount = data.passed || 0;
  const readyPct = data.total_vehicles > 0 ? Math.round((readyCount / data.total_vehicles) * 100) : 0;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-800">ภาพรวมตรวจสภาพรถ</h1>
        <p className="text-sm text-gray-500">สรุปสถานะรถรับส่งนักเรียนทั้งจังหวัด</p>
      </div>

      {/* Save success banner */}
      {highlightId && (() => {
        const sv = vehicles.find(v => v.id === highlightId);
        return sv ? (
          <div className="bg-green-50 border-2 border-green-300 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
            <p className="text-sm text-green-700 font-medium">✅ บันทึกผลตรวจของรถ <strong>{sv.plate_no}</strong> เรียบร้อยแล้ว</p>
            <button onClick={() => { setHighlightId(''); setSearchParams({}, { replace: true }); }} className="text-xs text-green-600 hover:text-green-800">✕</button>
          </div>
        ) : null;
      })()}

      {/* ── 1. Hero ── */}
      {urgentCount > 0 ? (
        <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-5 mb-6">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🚨</span>
            <div>
              <p className="text-2xl font-bold text-red-700">{urgentCount} คัน ต้องจัดการเร่งด่วน</p>
              <p className="text-sm text-red-600">ยังไม่ตรวจ {data.not_inspected} · ไม่มีข้อมูลประกัน {data.no_insurance_data}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-5 mb-6 text-center">
          <p className="text-lg font-bold text-green-700">✅ รถทุกคันพร้อมใช้งาน</p>
        </div>
      )}

      {/* ── 2. KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <KpiBox icon="🚨" label="เร่งด่วน" value={urgentCount}
          sub={`จาก ${data.total_vehicles} คัน`} color={urgentCount > 0 ? 'red' : 'green'} />
        <KpiBox icon="⚠️" label="ยังไม่ตรวจ" value={data.not_inspected}
          sub={data.total_vehicles > 0 ? `${Math.round((data.not_inspected / data.total_vehicles) * 100)}% ของทั้งหมด` : ''} color={data.not_inspected > 0 ? 'red' : 'green'} />
        <KpiBox icon="📋" label="ไม่มีข้อมูลประกัน" value={data.no_insurance_data}
          sub={`ปกติ ${data.insurance_ok || 0} คัน`} color={data.no_insurance_data > 0 ? 'yellow' : 'green'} />
        <KpiBox icon="✅" label="พร้อมใช้งาน" value={readyCount}
          sub={data.total_vehicles > 0 ? `${readyPct}% ของทั้งหมด` : ''} color="green" />
      </div>

      {/* ── 3. Quick Filters ── */}
      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map(f => {
          const count = filterCounts[f.key];
          const isActive = activeFilter === f.key;
          return (
            <button key={f.key} onClick={() => setActiveFilter(f.key)}
              className={`text-sm font-medium px-3 py-2 rounded-lg transition border ${
                isActive ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}>
              {f.label} <span className={`ml-1 text-xs font-bold ${isActive ? 'text-blue-100' : 'text-gray-400'}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input type="text" value={vSearch} onChange={e => setVSearch(e.target.value)}
          placeholder="ค้นหาทะเบียนรถ…"
          className="w-full sm:w-72 border-2 border-gray-200 rounded-xl px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
      </div>

      {/* ── 4. Filtered Vehicle List ── */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-gray-500 mb-3">
          {currentFilter.label} — {filtered.length} คัน
          {vSearch && ` (ค้นหา "${vSearch}")`}
        </h2>

        {filtered.length === 0 ? (
          <p className="text-gray-400 py-8 text-center">ไม่พบรถในกลุ่มนี้</p>
        ) : (
          <div className="space-y-2">
            {filtered.slice(0, 20).map(v => {
              const tags = riskTags(v);
              const prio = priorityLevel(v._score);
              const sug = suggestion(v);
              const isHighlighted = v.id === highlightId;
              return (
                <div key={v.id} ref={isHighlighted ? highlightRef : null}
                  className={`rounded-xl border p-4 transition-all ${isHighlighted ? 'bg-green-50 border-2 border-green-400 ring-2 ring-green-300' : 'bg-white border-gray-200'}`}>
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-base font-bold text-gray-900">{v.plate_no}</p>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${prio.cls}`}>{prio.text}</span>
                      </div>
                      <p className="text-sm text-gray-500">
                        {v.driver_name || 'ไม่ระบุคนขับ'} · {v.student_count || 0} คน
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((t, i) => (
                        <span key={i} className={`text-xs font-medium px-2.5 py-1 rounded-full ${t.cls}`}>{t.text}</span>
                      ))}
                    </div>
                  </div>

                  {/* Info row + SLA */}
                  <div className="flex flex-wrap gap-4 text-xs text-gray-500 mb-2">
                    <span>ตรวจ: {v.latest_inspection_result ? formatThaiDate(v.latest_inspection_date) : 'ยังไม่เคยตรวจ'}</span>
                    <span>ประกัน: {v.insurance_expiry ? formatThaiDate(v.insurance_expiry) : 'ไม่มีข้อมูล'}</span>
                    {v._score > 0 && (() => {
                      const sla = slaInfo(v);
                      if (!sla) return null;
                      return (
                        <span className={`px-2 py-0.5 rounded-full border text-xs ${sla.color}`}>
                          {sla.overdue
                            ? `เกิน SLA ${Math.abs(sla.daysLeft)} วัน`
                            : sla.daysLeft === 0
                              ? 'ครบกำหนด SLA วันนี้'
                              : `SLA เหลือ ${sla.daysLeft} วัน`}
                        </span>
                      );
                    })()}
                  </div>

                  {/* Suggestion + Action shortcuts */}
                  <div className="flex flex-wrap items-center gap-2">
                    {sug && (
                      <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                        💡 {sug}
                      </span>
                    )}
                    <button onClick={() => navigate(`/transport/inspections?vehicle_id=${v.id}`)}
                      className="text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-1 rounded-lg transition">
                      📝 บันทึกตรวจ
                    </button>
                    {v.driver_phone && (
                      <a href={`tel:${v.driver_phone}`}
                        className="text-xs text-green-600 bg-green-50 hover:bg-green-100 border border-green-200 px-2.5 py-1 rounded-lg transition">
                        📞 โทรคนขับ
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
            {filtered.length > 20 && (
              <p className="text-sm text-gray-400 text-center py-2">... แสดง 20 จาก {filtered.length} คัน</p>
            )}
          </div>
        )}
      </section>

      {/* ── 5. Charts ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-semibold text-gray-600 mb-3 text-center">ผลตรวจสภาพรถ</p>
          <DonutChart size={140} thickness={20}
            label={`${readyPct}%`} sublabel="พร้อมใช้งาน"
            segments={[
              { value: data.passed || 0, color: '#22c55e' },
              { value: data.needs_fix || 0, color: '#eab308' },
              { value: data.failed || 0, color: '#ef4444' },
              { value: data.not_inspected || 0, color: '#d1d5db' },
            ]}
          />
          <div className="flex flex-wrap justify-center gap-3 mt-3 text-sm">
            <span className="text-green-600 font-medium">● ผ่าน {data.passed}</span>
            <span className="text-yellow-600">● แก้ไข {data.needs_fix}</span>
            <span className="text-red-600">● ไม่ผ่าน {data.failed}</span>
            <span className="text-gray-400">● ยังไม่ตรวจ {data.not_inspected}</span>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm font-semibold text-gray-600 mb-4">สถานะประกันภัย</p>
          <div className="space-y-3">
            <InsBar label="มีประกัน (ปกติ)" value={data.insurance_ok || 0} total={data.total_vehicles} color="bg-green-500" />
            <InsBar label="ใกล้หมดอายุ" value={data.expiring_insurance || 0} total={data.total_vehicles} color="bg-yellow-400" />
            <InsBar label="หมดอายุแล้ว" value={data.expired_insurance || 0} total={data.total_vehicles} color="bg-red-500" />
            <InsBar label="ยังไม่กรอกข้อมูล" value={data.no_insurance_data || 0} total={data.total_vehicles} color="bg-gray-400" />
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiBox({ icon, label, value, sub, color }) {
  const bg = { red: 'bg-red-50 border-red-300', green: 'bg-green-50 border-green-300', yellow: 'bg-yellow-50 border-yellow-300', blue: 'bg-blue-50 border-blue-200' };
  const text = { red: 'text-red-700', green: 'text-green-700', yellow: 'text-yellow-700', blue: 'text-blue-700' };
  return (
    <div className={`rounded-xl border-2 p-4 text-center ${bg[color]}`}>
      <p className="text-2xl mb-1">{icon}</p>
      <p className={`text-2xl font-bold ${text[color]}`}>{value}</p>
      <p className="text-sm text-gray-600 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function InsBar({ label, value, total, color }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium">{value} ({pct}%)</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-3">
        <div className={`h-3 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
