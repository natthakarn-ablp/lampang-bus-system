import { useEffect, useState } from 'react';
import {
  ShieldCheck, CheckCircle2, FilePlus2, AlertTriangle, Ban,
  Bus, UserRoundCheck, UsersRound, RefreshCw,
} from 'lucide-react';
import api from '../../api/axios';
import { CommandHero, AlertBanner, AppCard, KPIGrid, StatusBadge, DataTable} from '../../components/ui';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';

// ── Status buckets (spec §6.3) — semantic via icon + text, never color alone ─
const BUCKET_META = {
  ready:      { label: 'พร้อมใช้งาน',   Icon: CheckCircle2,  tone: 'text-success', soft: 'bg-success-soft' },
  needs_data: { label: 'ต้องเติมข้อมูล', Icon: FilePlus2,     tone: 'text-info',    soft: 'bg-info-soft' },
  at_risk:    { label: 'มีข้อมูลเสี่ยง', Icon: AlertTriangle, tone: 'text-warn',    soft: 'bg-warn-soft' },
  suspended:  { label: 'ถูกระงับ',       Icon: Ban,           tone: 'text-danger',  soft: 'bg-danger-soft' },
};

const SECTION_META = {
  vehicles:    { label: 'รถพร้อมใช้งาน',          Icon: Bus,            sub: 'รถที่ผ่านเงื่อนไขความปลอดภัย' },
  drivers:     { label: 'คนขับมีใบอนุญาตรับรอง',   Icon: UserRoundCheck, sub: 'บัญชีคนขับที่ผูกโปรไฟล์และใบอนุญาตยังไม่หมดอายุ' },
  assignments: { label: 'รถมีคนขับที่อนุญาต',      Icon: UsersRound,     sub: 'รถที่มีคนขับได้รับอนุญาตอย่างน้อยหนึ่งคน' },
};

// Owner-role chips shown on each gap row.
const OWNER_LABEL = {
  school: 'โรงเรียน',
  transport: 'ขนส่ง',
  province: 'จังหวัด',
  affiliation: 'สังกัด',
  admin: 'ผู้ดูแลระบบ',
};

const th = (n) => Number(n || 0).toLocaleString('th-TH');

export default function DeploymentReadiness() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    setError('');
    api.get('/readiness')
      .then((res) => setData(res.data.data))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลความพร้อมไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const mode = data?.policy_mode || 'UNKNOWN';

  return (
    <div className="p-3 sm:p-6 max-w-6xl mx-auto pb-12 space-y-5">
      <CommandHero
        eyebrow="ความพร้อมก่อนเปิดใช้งานจริง"
        title="ความพร้อมเปิดใช้งานทั้งจังหวัด"
        description="ข้อมูลที่ยังไม่ได้รับรองจะถูกแสดงว่ายังไม่พร้อม ไม่แสดงเป็นผ่าน เพื่อไม่ให้เข้าใจผิดว่าปลอดภัยแล้ว"
        icon={ShieldCheck}
        meta={[`โหมดความปลอดภัย: ${mode === 'ENFORCE' ? 'บังคับใช้ (ENFORCE)' : 'สังเกตการณ์ (OBSERVE)'}`]}
        actions={
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/20 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={2} aria-hidden="true" />
            รีเฟรช
          </button>
        }
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {loading ? (
        <LoadingState message="กำลังประเมินความพร้อม…" />
      ) : data ? (
        <>
          {data.hard_gate_count > 0 ? (
            <AlertBanner variant="warn" title="ยังมีเงื่อนไขบังคับที่ต้องดำเนินการก่อนเปิดบังคับใช้">
              ต้องดำเนินการอีก {th(data.hard_gate_count)} รายการ
              {data.warning_count > 0 && ` และมีคำเตือนเพิ่มเติม ${th(data.warning_count)} รายการ`}
            </AlertBanner>
          ) : (
            <AlertBanner variant="success" title="ผ่านเงื่อนไขบังคับครบแล้ว">
              ไม่มีรายการบังคับค้างอยู่
              {data.warning_count > 0 && ` แต่ยังมีคำเตือน ${th(data.warning_count)} รายการที่ควรพิจารณา`}
            </AlertBanner>
          )}

          {/* ── Four readiness buckets (รถ) — stagger in on load ───────────── */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink-muted">สถานะรถตามความพร้อม</h2>
            <KPIGrid cols={4} gap="sm">
              {data.status_buckets.map((b) => {
                const meta = BUCKET_META[b.key] || BUCKET_META.needs_data;
                const Icon = meta.Icon;
                return (
                  <AppCard key={b.key} padding="md">
                    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${meta.soft}`}>
                      <Icon className={`h-5 w-5 ${meta.tone}`} strokeWidth={2} aria-hidden="true" />
                    </span>
                    <p className="mt-3 text-2xl font-bold tabular-nums text-ink">{th(b.count)}</p>
                    <p className={`text-sm font-medium ${meta.tone}`}>{meta.label}</p>
                  </AppCard>
                );
              })}
            </KPIGrid>
          </section>

          {/* ── Section completion summary ──────────────────────────────── */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink-muted">ความครบถ้วนของข้อมูลหลัก</h2>
            <KPIGrid cols={3} gap="sm">
              {Object.entries(SECTION_META).map(([key, meta]) => {
                const sec = data.sections?.[key];
                if (!sec) return null;
                const Icon = meta.Icon;
                const pct = Math.max(0, Math.min(100, Number(sec.pct) || 0));
                return (
                  <AppCard key={key} padding="lg">
                    <div className="flex items-center gap-2 text-ink">
                      <Icon className="h-5 w-5 text-brand-700" strokeWidth={2} aria-hidden="true" />
                      <h3 className="font-semibold">{meta.label}</h3>
                    </div>
                    <p className="mt-3 text-3xl font-bold tabular-nums text-ink">{pct}%</p>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface" aria-hidden="true">
                      <div
                        className="h-full rounded-full bg-brand-600"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-2 text-sm text-ink-muted">
                      พร้อม {th(sec.ready)} จาก {th(sec.total)}
                    </p>
                    {sec.missing > 0 && (
                      <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-warn">
                        <AlertTriangle className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                        ต้องดำเนินการ {th(sec.missing)}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-ink-muted">{meta.sub}</p>
                  </AppCard>
                );
              })}
            </KPIGrid>
          </section>

          {/* ── Gap list with owner + next action ───────────────────────── */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink-muted">รายการที่ต้องดำเนินการ</h2>
            {data.gaps.length === 0 ? (
              <AppCard className="text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-success" strokeWidth={1.8} aria-hidden="true" />
                <p className="mt-2 text-sm font-medium text-ink">ไม่มีรายการค้าง</p>
                <p className="text-xs text-ink-muted">ข้อมูลรถและคนขับพร้อมครบทุกเงื่อนไข</p>
              </AppCard>
            ) : (
              <AppCard padding="none" className="overflow-hidden">
                <DataTable
                  caption="รายการที่ยังไม่พร้อมเปิดใช้งาน"
                  rows={data.gaps}
                  rowKey={g => g.key}
                  columns={[
                    { key: 'label', header: 'รายการ', primary: true,
                      cell: g => <span className="font-medium text-ink">{g.label_th}</span> },
                    { key: 'kind', header: 'ประเภท', badge: true,
                      cell: g => (
                        <StatusBadge variant={g.hard_gate ? 'danger' : 'warn'} icon={AlertTriangle}>
                          {g.hard_gate ? 'บังคับ' : 'คำเตือน'}
                        </StatusBadge>
                      ) },
                    { key: 'owner', header: 'ผู้รับผิดชอบ', secondary: true,
                      cell: g => OWNER_LABEL[g.owner_role] || g.owner_role },
                    { key: 'count', header: 'จำนวน', numeric: true, cell: g => th(g.count) },
                    { key: 'next', header: 'การดำเนินการต่อไป', cell: g => g.next_action_th },
                  ]}
                  empty={{ icon: ShieldCheck, title: 'ไม่มีรายการค้าง' }}
                />
              </AppCard>
            )}
          </section>

          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <ShieldCheck className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            ข้อมูลสรุปเชิงตัวเลขเท่านั้น ไม่มีรายชื่อนักเรียน ผู้ปกครอง คนขับ หรือข้อมูลติดต่อ
          </p>
        </>
      ) : null}
    </div>
  );
}
