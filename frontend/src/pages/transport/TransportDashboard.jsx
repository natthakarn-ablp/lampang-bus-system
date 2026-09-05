import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  AlertTriangle, ClipboardList, CheckCircle2, Lightbulb,
  FileText, Phone, X, Search,
  // Phase 10.7A — icons for the combined-document expiry cards
  Clock, XCircle,
  // Phase 10.8UX-B-1 — action row icon for pickup map
  Map as MapIcon,
} from 'lucide-react';
import api from '../../api/axios';
import { DonutChart } from '../../components/MiniCharts';
import {
  AppCard, AlertBanner, KPIGrid, KPIStat,
  StatusBadge, DashboardSection, FilterBar} from '../../components/ui';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import PageHeader from '../../components/PageHeader';
import { PageTransition } from '../../lib/motion';

// SLA configuration — days allowed to resolve a risk item
const SLA_DAYS = 7;

function formatThaiDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

function slaInfo(v) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const insp = v.latest_inspection_result;

  let riskStart = null;
  let reason = '';

  if (insp === 'FAILED') {
    riskStart = v.latest_inspection_date ? new Date(v.latest_inspection_date) : null;
    reason = 'ตั้งแต่วันที่ไม่ผ่านตรวจ';
  } else if (insp === 'NEEDS_FIX') {
    riskStart = v.latest_inspection_date ? new Date(v.latest_inspection_date) : null;
    reason = 'ตั้งแต่วันที่ต้องแก้ไข';
  } else if (!insp) {
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

  // Variant for StatusBadge based on remaining days
  let variant = 'success';
  if (daysLeft <= 0) variant = 'danger';
  else if (daysLeft <= 2) variant = 'danger';
  else if (daysLeft <= 5) variant = 'warn';

  return { deadline, daysLeft, overdue, variant, reason };
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
  if (insp === 'FAILED')        tags.push({ text: 'ไม่ผ่านตรวจ',    variant: 'danger' });
  else if (!insp)               tags.push({ text: 'ยังไม่ตรวจ',     variant: 'danger' });
  else if (insp === 'NEEDS_FIX') tags.push({ text: 'ต้องแก้ไข',     variant: 'warn' });
  const hasIns = v.insurance_expiry != null;
  if (hasIns && new Date(v.insurance_expiry) < new Date())                                  tags.push({ text: 'ประกันหมด',      variant: 'danger' });
  else if (!hasIns)                                                                          tags.push({ text: 'ไม่มีข้อมูลประกัน', variant: 'neutral' });
  else if (new Date(v.insurance_expiry) < new Date(Date.now() + 30*86400000))                tags.push({ text: 'ประกันใกล้หมด',    variant: 'warn' });
  return tags;
}

function suggestion(v) {
  const insp = v.latest_inspection_result;
  if (insp === 'FAILED')   return 'ควรตรวจซ้ำ/แก้ไขทันที';
  if (!insp)               return 'ควรบันทึกผลตรวจ';
  if (insp === 'NEEDS_FIX') return 'ควรแก้ไขแล้วตรวจซ้ำ';
  const hasIns = v.insurance_expiry != null;
  if (hasIns && new Date(v.insurance_expiry) < new Date()) return 'ควรต่อประกัน';
  if (!hasIns) return 'ควรกรอกข้อมูลประกัน';
  if (hasIns && new Date(v.insurance_expiry) < new Date(Date.now() + 30*86400000)) return 'ประกันใกล้หมด ควรต่อล่วงหน้า';
  return null;
}

function priorityLevel(score) {
  if (score >= 100) return { text: 'เร่งด่วน',     variant: 'danger' };
  if (score >= 60)  return { text: 'ต้องติดตาม',  variant: 'warn' };
  if (score >= 20)  return { text: 'ข้อมูลไม่ครบ', variant: 'neutral' };
  return              { text: 'พร้อมใช้งาน',     variant: 'success' };
}

// Phase 10.7A — combined-document expiry helpers. A vehicle is "docs_expiring"
// if ANY of the 4 dated fields lands in the next 30 days, "docs_expired" if
// ANY is past due. NULL fields are ignored (counted as "not yet recorded",
// not as "expired") so vehicles with unfilled paperwork don't pollute counts.
const DOC_EXPIRY_FIELDS = [
  'insurance_expiry',
  'registration_expiry',
  'compulsory_insurance_expiry',
  'tax_expiry',
];

function hasAnyExpiringDoc(v) {
  const now = Date.now();
  const limit = now + 30 * 86400000;
  return DOC_EXPIRY_FIELDS.some(f => {
    if (!v[f]) return false;
    const t = new Date(v[f]).getTime();
    return t >= now && t <= limit;
  });
}

function hasAnyExpiredDoc(v) {
  const now = Date.now();
  return DOC_EXPIRY_FIELDS.some(f => v[f] && new Date(v[f]).getTime() < now);
}

const FILTERS = [
  { key: 'all',            label: 'ทั้งหมด',           fn: () => true },
  { key: 'urgent',         label: 'เร่งด่วน',          fn: v => riskScore(v) >= 100 },
  { key: 'not_inspected',  label: 'ยังไม่ตรวจ',         fn: v => !v.latest_inspection_result },
  { key: 'failed',         label: 'ไม่ผ่าน',           fn: v => v.latest_inspection_result === 'FAILED' },
  { key: 'needs_fix',      label: 'ต้องแก้ไข',         fn: v => v.latest_inspection_result === 'NEEDS_FIX' },
  { key: 'ins_expired',    label: 'ประกันหมด',         fn: v => v.insurance_expiry && new Date(v.insurance_expiry) < new Date() },
  { key: 'no_ins',         label: 'ไม่มีข้อมูลประกัน',   fn: v => !v.insurance_expiry },
  { key: 'ins_expiring',   label: 'ใกล้หมดอายุ',        fn: v => v.insurance_expiry && new Date(v.insurance_expiry) >= new Date() && new Date(v.insurance_expiry) < new Date(Date.now() + 30*86400000) },
  // Phase 10.7A — combined-document filters across the 4 expiry fields
  { key: 'docs_expiring',  label: 'เอกสารใกล้หมด',     fn: hasAnyExpiringDoc },
  { key: 'docs_expired',   label: 'เอกสารหมดอายุ',     fn: hasAnyExpiredDoc },
  { key: 'ready',          label: 'พร้อมใช้งาน',       fn: v => riskScore(v) === 0 },
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
      // `vList || []` let a non-array response through (an error envelope or an
      // object body is truthy), and every downstream vehicles.filter(...) then
      // threw, blanking the whole dashboard. Guard on the shape, not on
      // truthiness.
      .then(([dash, vList]) => { setData(dash); setVehicles(Array.isArray(vList) ? vList : []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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

  const filterCounts = useMemo(() => {
    const counts = {};
    FILTERS.forEach(f => { counts[f.key] = vehicles.filter(f.fn).length; });
    return counts;
  }, [vehicles]);

  const currentFilter = FILTERS.find(f => f.key === activeFilter) || FILTERS[0];
  const filtered = useMemo(() => {
    let list = vehicles.filter(currentFilter.fn);
    if (vSearch) list = list.filter(v => v.plate_no?.toLowerCase().includes(vSearch.toLowerCase()));
    return list.map(v => ({ ...v, _score: riskScore(v) })).sort((a, b) => b._score - a._score);
  }, [vehicles, activeFilter, vSearch, currentFilter]);

  if (loading) return <LoadingState />;
  if (!data)   return <EmptyState title="ยังไม่มีข้อมูล" />;

  const urgentCount = vehicles.filter(v => riskScore(v) >= 100).length;
  const readyCount = data.passed || 0;
  const readyPct = data.total_vehicles > 0 ? Math.round((readyCount / data.total_vehicles) * 100) : 0;

  return (
    <PageTransition>
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader
        title="ภาพรวมตรวจสภาพรถ"
        subtitle="สรุปสถานะรถและการตรวจสภาพทั้งจังหวัด"
      />

      {/* Phase 10.8UX-B-1 — action row. Mirrors the SchoolDashboard pattern
          (flex-1 sm:flex-none + min-h 40px) so transport operators can tap
          straight to inspection record / pickup map without scrolling. */}
      <div className="flex flex-wrap items-stretch gap-2">
        <Link
          to="/transport/inspections"
          className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-surface-raised hover:bg-surface active:bg-surface-border text-ink text-sm font-medium px-3.5 py-2 rounded-lg transition border border-surface-border min-h-[44px]"
        >
          <ClipboardList className="w-4 h-4" strokeWidth={2} />
          บันทึกตรวจสภาพ
        </Link>
        <Link
          to="/transport/pickup-map"
          className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-surface-raised hover:bg-surface active:bg-surface-border text-ink text-sm font-medium px-3.5 py-2 rounded-lg transition border border-surface-border min-h-[44px]"
        >
          <MapIcon className="w-4 h-4" strokeWidth={2} />
          แผนที่จุดรับส่ง
        </Link>
      </div>

      {/* Save success banner */}
      {highlightId && (() => {
        const sv = vehicles.find(v => v.id === highlightId);
        return sv ? (
          <AlertBanner
            variant="success"
            title={`บันทึกผลตรวจของรถ ${sv.plate_no} เรียบร้อยแล้ว`}
            onClose={() => { setHighlightId(''); setSearchParams({}, { replace: true }); }}
          />
        ) : null;
      })()}

      {/* Hero status */}
      {(() => {
        if ((data.total_vehicles ?? 0) === 0) {
          return <AlertBanner variant="info" title="ยังไม่มีรถในระบบ">เพิ่มรถผ่านโรงเรียนเพื่อเริ่มตรวจสภาพ</AlertBanner>;
        }
        if (urgentCount > 0) {
          return (
            <AlertBanner variant="danger" title={`${urgentCount} คัน ต้องจัดการเร่งด่วน`}>
              ยังไม่ตรวจ {data.not_inspected} · ไม่มีข้อมูลประกัน {data.no_insurance_data}
            </AlertBanner>
          );
        }
        return <AlertBanner variant="success" title="รถทุกคันพร้อมใช้งาน" />;
      })()}

      {/* KPI grid — neutral when no vehicles in scope yet.
          Phase 10.7A — 4-card grid grew to 6 (added เอกสารใกล้หมด /
          เอกสารหมดอายุ). cols={3} keeps 2 clean rows on desktop and stacks
          naturally on mobile. The 2 new cards are clickable to drop the
          dashboard's local filter on the rendered vehicle list below. */}
      {(() => {
        const noFleet = (data.total_vehicles ?? 0) === 0;
        const expiringDocs = data.expiring_docs_count || 0;
        const expiredDocs  = data.expired_docs_count  || 0;
        return (
          <KPIGrid cols={3} gap="sm">
            <KPIStat
              label="เร่งด่วน"
              value={noFleet ? '–' : urgentCount}
              icon={AlertTriangle}
              variant={noFleet ? 'neutral' : urgentCount > 0 ? 'danger' : 'success'}
              hint={noFleet ? 'ยังไม่มีรถในระบบ' : `จาก ${data.total_vehicles} คัน`}
            />
            <KPIStat
              label="ยังไม่ตรวจ"
              value={noFleet ? '–' : data.not_inspected}
              icon={ClipboardList}
              variant={noFleet ? 'neutral' : data.not_inspected > 0 ? 'danger' : 'success'}
              hint={noFleet
                ? null
                : `${Math.round((data.not_inspected / data.total_vehicles) * 100)}% ของทั้งหมด`}
            />
            <KPIStat
              label="ไม่มีข้อมูลประกัน"
              value={noFleet ? '–' : data.no_insurance_data}
              icon={FileText}
              variant={noFleet ? 'neutral' : data.no_insurance_data > 0 ? 'warn' : 'success'}
              hint={noFleet ? null : `ปกติ ${data.insurance_ok || 0} คัน`}
            />
            <KPIStat
              label="พร้อมใช้งาน"
              value={noFleet ? '–' : readyCount}
              icon={CheckCircle2}
              variant={noFleet ? 'neutral' : 'success'}
              hint={noFleet ? null : `${readyPct}% ของทั้งหมด`}
            />
            <button
              type="button"
              onClick={() => setActiveFilter('docs_expiring')}
              className="text-left rounded-2xl focus:outline-none focus:ring-2 focus:ring-warn/50"
              aria-label="ดูรถที่เอกสารใกล้หมด"
            >
              <KPIStat
                label="เอกสารใกล้หมด"
                value={noFleet ? '–' : expiringDocs}
                icon={Clock}
                variant={noFleet ? 'neutral' : expiringDocs > 0 ? 'warn' : 'success'}
                hint={noFleet ? null : 'ประกัน · ทะเบียน · พ.ร.บ. · ภาษี · ใน 30 วัน'}
              />
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('docs_expired')}
              className="text-left rounded-2xl focus:outline-none focus:ring-2 focus:ring-danger/50"
              aria-label="ดูรถที่เอกสารหมดอายุ"
            >
              <KPIStat
                label="เอกสารหมดอายุ"
                value={noFleet ? '–' : expiredDocs}
                icon={XCircle}
                variant={noFleet ? 'neutral' : expiredDocs > 0 ? 'danger' : 'success'}
                hint={noFleet ? null : 'รวมทุกประเภทเอกสารที่เลยกำหนด'}
              />
            </button>
          </KPIGrid>
        );
      })()}

      {/* The chip row and the search box were a hand-rolled pair; the chips
          were styled buttons rather than a radiogroup, and the search input
          had no accessible name — a placeholder is not one. */}
      <FilterBar
        chips={{
          label: 'กรองรถตามความเสี่ยง',
          value: activeFilter,
          onChange: setActiveFilter,
          options: FILTERS.map(f => [f.key, f.label, filterCounts[f.key]]),
        }}
        search={{
          value: vSearch,
          onChange: setVSearch,
          label: 'ค้นหาทะเบียนรถ',
          placeholder: 'ค้นหาทะเบียนรถ…',
        }}
        count={filtered.length}
        countLabel="คัน"
        onClear={(activeFilter !== FILTERS[0].key || vSearch)
          ? () => { setActiveFilter(FILTERS[0].key); setVSearch(''); }
          : undefined}
      />

      {/* Vehicle list */}
      <DashboardSection
        title={`${currentFilter.label} — ${filtered.length} คัน`}
        description={vSearch ? `ค้นหา "${vSearch}"` : null}
      >
        {filtered.length === 0 ? (
          <AppCard padding="lg" className="text-center">
            <p className="text-ink-muted">ไม่พบรถในกลุ่มนี้</p>
          </AppCard>
        ) : (
          <div className="space-y-2">
            {filtered.slice(0, 20).map(v => (
              <VehicleRiskRow
                key={v.id}
                vehicle={v}
                isHighlighted={v.id === highlightId}
                rowRef={v.id === highlightId ? highlightRef : null}
                onRecord={() => navigate(`/transport/inspections?vehicle_id=${v.id}`)}
              />
            ))}
            {filtered.length > 20 && (
              <p className="text-sm text-ink-muted text-center py-2">… แสดง 20 จาก {filtered.length} คัน</p>
            )}
          </div>
        )}
      </DashboardSection>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AppCard padding="lg">
          <p className="text-sm font-semibold text-ink-muted mb-3 text-center">ผลตรวจสภาพรถ</p>
          <DonutChart
            size={140} thickness={20}
            label={`${readyPct}%`} sublabel="พร้อมใช้งาน"
            segments={[
              { value: data.passed || 0,         color: '#10B981' },
              { value: data.needs_fix || 0,      color: '#F59E0B' },
              { value: data.failed || 0,         color: '#EF4444' },
              { value: data.not_inspected || 0,  color: '#CBD5E1' },
            ]}
          />
          <div className="flex flex-wrap justify-center gap-3 mt-3 text-sm">
            <span className="text-success-ink font-medium">● ผ่าน {data.passed}</span>
            <span className="text-warn-ink">● แก้ไข {data.needs_fix}</span>
            <span className="text-danger-ink">● ไม่ผ่าน {data.failed}</span>
            <span className="text-ink-muted">● ยังไม่ตรวจ {data.not_inspected}</span>
          </div>
        </AppCard>
        <AppCard padding="lg">
          <p className="text-sm font-semibold text-ink-muted mb-4">สถานะประกันภัย</p>
          <div className="space-y-3">
            <InsBar label="มีประกัน (ปกติ)"  value={data.insurance_ok || 0}        total={data.total_vehicles} tone="success" />
            <InsBar label="ใกล้หมดอายุ"      value={data.expiring_insurance || 0}  total={data.total_vehicles} tone="warn" />
            <InsBar label="หมดอายุแล้ว"      value={data.expired_insurance || 0}   total={data.total_vehicles} tone="danger" />
            <InsBar label="ยังไม่กรอกข้อมูล"  value={data.no_insurance_data || 0}   total={data.total_vehicles} tone="neutral" />
          </div>
        </AppCard>
      </div>
    </div>
    </PageTransition>
  );
}

/* ── Domain row: vehicle with risk tags + SLA + action shortcuts ── */
function VehicleRiskRow({ vehicle: v, isHighlighted, rowRef, onRecord }) {
  const tags = riskTags(v);
  const prio = priorityLevel(v._score);
  const sug = suggestion(v);
  const sla = v._score > 0 ? slaInfo(v) : null;

  return (
    <AppCard
      as="div"
      ref={rowRef}
      padding="md"
      className={isHighlighted ? 'border-success ring-2 ring-success/40' : ''}
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
        <div>
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <p className="text-base font-semibold text-ink">{v.plate_no}</p>
            <StatusBadge variant={prio.variant} size="sm">{prio.text}</StatusBadge>
          </div>
          <p className="text-sm text-ink-muted">
            {v.driver_name || 'ไม่ระบุคนขับ'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t, i) => (
            <StatusBadge key={i} variant={t.variant} size="sm">{t.text}</StatusBadge>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted mb-2">
        <span>ตรวจ: {v.latest_inspection_result ? formatThaiDate(v.latest_inspection_date) : 'ยังไม่เคยตรวจ'}</span>
        <span>ประกัน: {v.insurance_expiry ? formatThaiDate(v.insurance_expiry) : 'ไม่มีข้อมูล'}</span>
        {sla && (
          <StatusBadge variant={sla.variant} size="sm">
            {sla.overdue
              ? `เกิน SLA ${Math.abs(sla.daysLeft)} วัน`
              : sla.daysLeft === 0
                ? 'ครบกำหนด SLA วันนี้'
                : `SLA เหลือ ${sla.daysLeft} วัน`}
          </StatusBadge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {sug && (
          <span className="inline-flex items-center gap-1.5 text-xs text-warn-ink bg-warn-soft border border-warn/30 px-2 py-1 rounded-lg">
            <Lightbulb className="w-3.5 h-3.5" strokeWidth={2} />
            {sug}
          </span>
        )}
        <button
          type="button"
          onClick={onRecord}
          className="focus-ring inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 active:bg-brand-200 border border-brand-200 px-3 min-h-[44px] rounded-lg transition"
        >
          <FileText className="w-3.5 h-3.5" strokeWidth={2} />
          บันทึกตรวจ
        </button>
        {v.driver_phone && (
          <a
            href={`tel:${v.driver_phone}`}
            className="inline-flex items-center gap-1.5 text-xs text-success-ink bg-success-soft hover:bg-success/20 border border-success/30 px-2.5 py-1 rounded-lg transition"
          >
            <Phone className="w-3.5 h-3.5" strokeWidth={2} />
            โทรคนขับ
          </a>
        )}
      </div>
    </AppCard>
  );
}

function InsBar({ label, value, total, tone }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const bar = tone === 'success' ? 'bg-success'
            : tone === 'warn'    ? 'bg-warn'
            : tone === 'danger'  ? 'bg-danger'
            : 'bg-ink-muted';
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-ink-muted">{label}</span>
        <span className="font-medium text-ink tabular-nums">{value} ({pct}%)</span>
      </div>
      <div className="w-full bg-surface rounded-full h-2.5">
        <div className={`h-2.5 rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
