import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  ClipboardList, Lightbulb, FileText, Phone,
  // Phase 10.8UX-B-1 — action row icon for pickup map
  Map as MapIcon,
} from 'lucide-react';
import api from '../../api/axios';
import { DonutChart } from '../../components/MiniCharts';
import {
  AppCard, AlertBanner, StatusBadge, DashboardSection, FilterBar,
  TodayBanner, TodoCards, KpiRingCard, RankBars, FoldSection, RoleChip,
  pctOf, pctTone,
} from '../../components/ui';
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

const in30Days = () => new Date(Date.now() + 30 * 86400000);

// Five groups instead of the old eleven chips. Each maps onto the client-side
// risk tags above; a vehicle may sit in more than one group.
const FILTERS = [
  { key: 'all',      label: 'ทั้งหมด',  fn: () => true },
  // expired documents, failed inspection, or a risk score at the urgent level
  { key: 'urgent',   label: 'เร่งด่วน', fn: v => riskScore(v) >= 100 || v.latest_inspection_result === 'FAILED' || hasAnyExpiredDoc(v) },
  // never inspected, or inspected and told to fix something
  { key: 'pending',  label: 'รอตรวจ',   fn: v => !v.latest_inspection_result || v.latest_inspection_result === 'NEEDS_FIX' },
  // any document due in 30 days, or no insurance recorded at all
  { key: 'expiring', label: 'ใกล้หมด',  fn: v => hasAnyExpiringDoc(v) || !v.insurance_expiry
      || (v.insurance_expiry && new Date(v.insurance_expiry) >= new Date() && new Date(v.insurance_expiry) < in30Days()) },
  { key: 'ready',    label: 'พร้อมใช้', fn: v => riskScore(v) === 0 },
];

// The vehicle list endpoint caps per_page at 100 (transport.routes.js), so the
// risk list and its chip counts only ever see the first page. KPIs and the
// banner therefore read /transport/dashboard alone, and the list says how many
// vehicles it covers. A complete list needs backend paging or server-side
// filtering by risk group — not done here.
const LIST_PAGE_SIZE = 100;

export default function TransportDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const savedParam = searchParams.get('saved') || '';
  const [highlightId, setHighlightId] = useState(savedParam);
  const highlightRef = useRef(null);
  const listRef = useRef(null);

  const [data, setData] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [listTotal, setListTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [vSearch, setVSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');

  useEffect(() => {
    Promise.all([
      api.get('/transport/dashboard').then(r => r.data.data),
      api.get(`/transport/vehicles?per_page=${LIST_PAGE_SIZE}`).then(r => r.data).catch(() => null),
    ])
      // Guard on the shape, not on truthiness: an error envelope or an object
      // body used to slip through and blank the whole dashboard.
      .then(([dash, body]) => {
        setData(dash);
        const list = Array.isArray(body?.data) ? body.data : [];
        setVehicles(list);
        setListTotal(Number(body?.meta?.total) || list.length);
      })
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

  const n = k => Number(data[k]) || 0;
  const total        = n('total_vehicles');
  const noFleet      = total === 0;
  const failed       = n('failed');
  const expiredIns   = n('expired_insurance');
  const expiredDocs  = n('expired_docs_count');
  const expiringIns  = n('expiring_insurance');
  const expiringDocs = n('expiring_docs_count');
  const notInspected = n('not_inspected');
  const noInsurance  = n('no_insurance_data');
  const passed       = n('passed');
  const needsFix     = n('needs_fix');
  // A vehicle can be both failed and expired; the sum is "items to handle",
  // which is what the banner promises, not a distinct vehicle count.
  const urgentItems  = failed + expiredIns + expiredDocs;
  const readyPct     = pctOf(passed, total);
  const shareOf      = v => (total > 0 ? `${Math.round((v / total) * 100)}% ของทั้งหมด` : '');

  function showUrgent() {
    setActiveFilter('urgent');
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  let banner;
  let bannerTopic = null;
  if (noFleet) {
    banner = { variant: 'info', title: 'ยังไม่มีรถในระบบ', sub: 'เพิ่มรถผ่านโรงเรียนเพื่อเริ่มตรวจสภาพ' };
  } else if (urgentItems > 0) {
    const parts = [];
    if (failed > 0)      parts.push(`ตรวจไม่ผ่าน ${failed}`);
    if (expiredIns > 0)  parts.push(`ประกันหมดอายุ ${expiredIns}`);
    if (expiredDocs > 0) parts.push(`เอกสารอื่นหมดอายุ ${expiredDocs}`);
    banner = {
      variant: 'danger',
      title: `${urgentItems.toLocaleString('th-TH')} คันต้องจัดการเร่งด่วน`,
      sub: parts.join(' · '),
      cta: { label: 'ดูรถเร่งด่วน', onClick: showUrgent },
    };
    bannerTopic = 'urgent';
  } else if (notInspected > 0) {
    banner = {
      variant: 'warn',
      title: `รถยังไม่ได้ตรวจสภาพ ${notInspected.toLocaleString('th-TH')} คัน`,
      sub: `${shareOf(notInspected)} · ไม่มีรถที่หมดอายุหรือตรวจไม่ผ่าน`,
      cta: { label: 'บันทึกตรวจสภาพ', to: '/transport/inspections' },
    };
    bannerTopic = 'not_inspected';
  } else {
    banner = { variant: 'success', title: 'รถทุกคันพร้อมใช้งาน', sub: `ตรวจผ่าน ${passed.toLocaleString('th-TH')} จาก ${total.toLocaleString('th-TH')} คัน` };
  }

  const todos = [
    bannerTopic !== 'not_inspected' && {
      key: 'not_inspected', variant: 'warn', count: notInspected,
      title: 'รถยังไม่ได้ตรวจสภาพ', sub: shareOf(notInspected),
      cta: { label: 'บันทึกตรวจสภาพ', to: '/transport/inspections' },
    },
    {
      key: 'expiring', variant: 'warn', count: expiringIns + expiringDocs,
      title: 'เอกสารใกล้หมดใน 30 วัน', sub: `ประกัน ${expiringIns} · เอกสารอื่น ${expiringDocs}`,
      cta: { label: 'ดูรายการ', onClick: () => { setActiveFilter('expiring'); listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
    },
    {
      key: 'no_ins', variant: 'warn', count: noInsurance,
      title: 'ไม่มีข้อมูลประกัน', sub: 'ควรกรอกวันหมดอายุประกัน',
      cta: { label: 'ดูรายการ', onClick: () => { setActiveFilter('expiring'); listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
    },
  ].filter(Boolean);

  const docRows = [
    { key: 'ins_soon', label: 'ประกันใกล้หมด',     value: expiringIns,  variant: 'warn' },
    { key: 'ins_out',  label: 'ประกันหมดอายุ',     value: expiredIns,   variant: 'danger' },
    { key: 'doc_soon', label: 'เอกสารอื่นใกล้หมด', value: expiringDocs, variant: 'warn' },
    { key: 'doc_out',  label: 'เอกสารอื่นหมดอายุ', value: expiredDocs,  variant: 'danger' },
  ];
  const docMax = Math.max(1, ...docRows.map(r => r.value));
  const listPartial = listTotal > vehicles.length;

  return (
    <PageTransition>
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col gap-2">
        <RoleChip role="transport" />
        <PageHeader
          title="ภาพรวมตรวจสภาพรถ"
          subtitle="สรุปสถานะรถและการตรวจสภาพทั้งจังหวัด"
          actions={
            <div className="flex flex-wrap items-stretch gap-2">
              <Link
                to="/transport/inspections"
                className="focus-ring inline-flex items-center justify-center gap-1.5 bg-surface-raised hover:bg-surface text-ink text-sm font-medium px-3.5 rounded-xl transition border border-surface-border min-h-[44px]"
              >
                <ClipboardList className="w-4 h-4" strokeWidth={2} />
                บันทึกตรวจสภาพ
              </Link>
              <Link
                to="/transport/pickup-map"
                className="focus-ring inline-flex items-center justify-center gap-1.5 bg-surface-raised hover:bg-surface text-ink text-sm font-medium px-3.5 rounded-xl transition border border-surface-border min-h-[44px]"
              >
                <MapIcon className="w-4 h-4" strokeWidth={2} />
                แผนที่จุดรับส่ง
              </Link>
            </div>
          }
        />
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

      <TodayBanner {...banner} />

      {!noFleet && <TodoCards items={todos} />}

      {!noFleet && (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiRingCard
            label="พร้อมใช้งาน"
            pct={readyPct}
            sub={`${passed.toLocaleString('th-TH')} / ${total.toLocaleString('th-TH')} คัน`}
            variant={pctTone(readyPct)}
          />
          <KpiRingCard
            label="ยังไม่ตรวจ"
            value={notInspected}
            sub={shareOf(notInspected)}
            variant={notInspected > 0 ? 'warn' : 'success'}
            chip={notInspected > 0 ? undefined : 'ไม่มี'}
          />
          <KpiRingCard
            label="ไม่มีข้อมูลประกัน"
            value={noInsurance}
            sub={shareOf(noInsurance)}
            variant={noInsurance > 0 ? 'warn' : 'success'}
            chip={noInsurance > 0 ? undefined : 'ไม่มี'}
          />
          <KpiRingCard
            label="หมดอายุ / ไม่ผ่าน"
            value={urgentItems}
            sub={urgentItems > 0 ? 'ต้องแก้ก่อนให้บริการ' : 'ไม่มีรถที่หมดอายุหรือไม่ผ่าน'}
            variant={urgentItems > 0 ? 'danger' : 'success'}
            chip={urgentItems > 0 ? undefined : 'ไม่มี'}
            onClick={urgentItems > 0 ? showUrgent : undefined}
          />
        </section>
      )}

      {!noFleet && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-surface-raised border border-surface-border rounded-2xl shadow-soft p-5 flex flex-col gap-3 min-w-0">
            <h3 className="font-bold text-ink">สถานะรถทั้งหมด</h3>
            <DonutChart
              size={150} thickness={22}
              label={readyPct == null ? '–' : `${readyPct}%`} sublabel="พร้อมใช้งาน"
              segments={[
                { label: 'ผ่าน',        value: passed,       color: '#10B981' },
                { label: 'ต้องแก้ไข',   value: needsFix,     color: '#F59E0B' },
                { label: 'ไม่ผ่าน',     value: failed,       color: '#EF4444' },
                { label: 'ยังไม่ตรวจ',  value: notInspected, color: '#94A3B8' },
              ]}
            />
          </div>
          <RankBars
            title="เอกสารที่ต้องดูแล"
            sub="ใน 30 วัน / เลยกำหนด"
            rows={docRows.map(r => ({
              key: r.key, label: r.label, variant: r.value > 0 ? r.variant : 'success',
              width: (r.value / docMax) * 100, text: `${r.value.toLocaleString('th-TH')} คัน`,
            }))}
          />
        </section>
      )}

      {/* Vehicle list */}
      <div ref={listRef} className="space-y-3 scroll-mt-4">
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
        {listPartial && (
          <p className="text-xs text-ink-muted">
            ตัวเลขในปุ่มกรองนับจากรถที่แสดงในรายการนี้เท่านั้น ({vehicles.length.toLocaleString('th-TH')} คัน) ตัวเลขทั้งจังหวัดดูจากการ์ดด้านบน
          </p>
        )}

        <DashboardSection
          title={`${currentFilter.label} — ${filtered.length} คัน`}
          description={[
            listPartial ? `แสดง ${vehicles.length.toLocaleString('th-TH')} คันจากทั้งหมด ${listTotal.toLocaleString('th-TH')} คัน` : null,
            vSearch ? `ค้นหา "${vSearch}"` : null,
          ].filter(Boolean).join(' · ') || null}
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
      </div>

      {!noFleet && (
        <FoldSection
          title="สถานะประกันภัย"
          subtitle={`ปกติ ${n('insurance_ok')} · ใกล้หมด ${expiringIns} · หมดอายุ ${expiredIns} · ยังไม่กรอก ${noInsurance}`}
        >
          <div className="space-y-3">
            <InsBar label="มีประกัน (ปกติ)"  value={n('insurance_ok')} total={total} tone="success" />
            <InsBar label="ใกล้หมดอายุ"      value={expiringIns}       total={total} tone="warn" />
            <InsBar label="หมดอายุแล้ว"      value={expiredIns}        total={total} tone="danger" />
            <InsBar label="ยังไม่กรอกข้อมูล"  value={noInsurance}       total={total} tone="neutral" />
          </div>
        </FoldSection>
      )}
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
