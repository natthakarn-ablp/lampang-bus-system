import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Gavel, Inbox, MessageSquareReply, PieChart } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { AppCard, AlertBanner, StatusBadge, KPIGrid, KPIStat, SectionTitle } from '../../components/ui';
import { snapshotPct, fmtSnapshotPct } from '../../utils/kpi';
import { CASE_TYPE_LABEL, ROLE_LABEL, STATUS_LABEL } from './constants';

/**
 * The aggregate view of "งานที่ต้องมีส่วนร่วม".
 *
 * GET /api/participation/summary has existed since the feature went live but
 * nothing ever called it, so the counts it computes were only reachable through
 * the API. This page is that endpoint's only consumer.
 *
 * COUNTS, NOT A FINDING
 * The service is explicit that this is an operational tally and not a research
 * result (participation.service.js summariseParticipation returns `note` saying
 * so). That sentence is rendered verbatim at the top of the page rather than
 * paraphrased here, so the claim the user reads is the claim the server makes
 * and the two cannot drift apart.
 *
 * SCOPE IS NOT A FILTER
 * Every row behind these numbers is already inside the caller's scope, decided
 * in SQL from the token (participation.routes.js scopeClause): a school totals
 * its own cases, an affiliation the schools under it, a driver only what they
 * raised themselves, province and admin the whole province. There is
 * deliberately no scope selector — offering one would imply the totals could
 * be widened, and they cannot.
 */

/**
 * WHY THE `overdue` FIGURE IS NOT SHOWN AS A NUMBER
 *
 * summariseParticipation counts a case as overdue when `due_at` has passed and
 * `completed_at` is still empty. But `due_at` is only ever written alongside an
 * ASSIGNED event (participation.service.js, the ASSIGNED branch of appendEvent
 * writes it only `if (v.dueAt)`), and the one thing in the system that posts an
 * ASSIGNED event is the append form in ParticipationCaseDetail.jsx, which sends
 * `assigned_to` and nothing else. No screen anywhere collects a due date, so
 * `due_at` is NULL on every row and the count is structurally zero.
 *
 * A card reading "เกินกำหนด 0" would tell the reader that nothing is late. The
 * data cannot support that: no case has a deadline it could be late against.
 * Until the assign form grows a due-date field, the honest rendering is to name
 * it as not yet measurable and say why — the same rule the research pages
 * follow when a denominator is missing (utils/kpi.js snapshotPct: null, never
 * 0%, because "0%" is a finding and null is the absence of one).
 */

/**
 * The roles a case can be raised by.
 *
 * `by_initiator_role` carries a bucket for every role the service knows,
 * including `parent` — but the router admits only these six (its requireRole
 * list), so a parent cannot open a case at all and that bucket is always zero
 * for the same structural reason as `overdue`. Listing it would read as "no
 * parent has ever raised a concern" when the truth is that no parent can.
 * backend/tests/participationSummaryPage.unit.test.js fails if this list and
 * the router's stop agreeing.
 */
const INITIATOR_ROLES = ['school', 'affiliation', 'province', 'transport', 'driver', 'admin'];

/** Fallback only. The server sends this sentence; this is what shows if it does not. */
const INTEGRITY_NOTE = 'ตัวชี้วัดการมีส่วนร่วม แยกจาก operational KPI และไม่ใช่ผลการวิจัย';

const STATUS_ORDER = [
  'SUBMITTED', 'ACKNOWLEDGED', 'IN_CONSULTATION', 'DECIDED',
  'ASSIGNED', 'COMPLETED', 'CLOSED', 'WITHDRAWN',
];

const fmtCount = (n) => Number(n ?? 0).toLocaleString('th-TH');

export default function ParticipationSummary() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notMounted, setNotMounted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotMounted(false);
    try {
      const res = await api.get('/participation/summary');
      setData(res.data?.data ?? null);
    } catch (err) {
      // The feature is dark by default. With FEATURE_PARTICIPATION_CASES off the
      // router is not mounted and this 404s, which is a different thing from
      // "there are no cases" — the list page draws the same distinction.
      setNotMounted(err.response?.status === 404);
      setError(err.response?.data?.message || 'โหลดสรุปการมีส่วนร่วมไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const backLink = (
    <Link
      to="/participation"
      className="focus-ring inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-surface-border bg-surface-raised text-sm text-ink hover:bg-surface transition"
    >
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      กลับไปรายการ
    </Link>
  );

  if (loading) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <LoadingState />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        {notMounted ? (
          <AlertBanner variant="info" title="ยังไม่ได้เปิดใช้งานส่วนนี้">
            ระบบยังไม่ได้เปิด FEATURE_PARTICIPATION_CASES กรุณาติดต่อผู้ดูแลระบบ
          </AlertBanner>
        ) : (
          <ErrorState message={error} onRetry={load} />
        )}
        {backLink}
      </div>
    );
  }

  const total = data.total ?? 0;
  const byStatus = data.by_status || {};
  const byType = data.by_type || {};
  const byRole = data.by_initiator_role || {};

  // The server already divides the closed loop by the total, and answers null
  // rather than 0 when there is nothing to divide.
  const closedPct = data.closed_feedback_loop_pct ?? null;

  // The second rate is computed here because the summary returns
  // `decided_with_rationale` as a bare count. `total` is the only denominator
  // it offers, and it is also the only honest one: the service refuses a
  // DECIDED event that carries no rationale, so "decisions that had a reason"
  // over "decisions" would be 100% by construction and would measure nothing.
  // Over every case it answers a question worth asking — how much of what was
  // raised has reached a reasoned decision — and the label says exactly that.
  const rationalePct = snapshotPct(data.decided_with_rationale, total);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto motion-safe:animate-fade-in-up motion-reduce:animate-none">
      <PageHeader
        title="สรุปการมีส่วนร่วม"
        subtitle="จำนวนเรื่องตามสถานะ ประเภท และผู้เสนอ ในขอบเขตที่ท่านดูแล"
        icon={PieChart}
        iconColor="indigo"
        actions={backLink}
      />

      {/* The server's own words, not a paraphrase — see the note at the top of
          this file about why this sentence comes from the payload. */}
      <AlertBanner variant="warn" title="ตัวเลขนี้เป็นการนับงาน ไม่ใช่ผลการวิจัย" className="mb-5">
        {data.note || INTEGRITY_NOTE}
      </AlertBanner>

      {/* Both rates get a tile of their own rather than a footnote under the
          count they came from: closing the loop is the thing this feature was
          built to make visible, and a percentage tucked into a hint is read as
          an aside. */}
      <KPIGrid cols={5}>
        <KPIStat
          label="เรื่องทั้งหมด"
          value={total}
          icon={Inbox}
          variant="brand"
          hint="ทุกสถานะ รวมเรื่องที่ปิดและถอนแล้ว"
        />
        <KPIStat
          label="แจ้งผลกลับผู้เสนอแล้ว"
          value={data.closed_feedback_loop ?? 0}
          icon={MessageSquareReply}
          variant="success"
          hint="เรื่องที่มีเหตุการณ์ FEEDBACK_SENT"
        />
        <KPIStat
          label="สัดส่วนที่แจ้งผลกลับแล้ว"
          value={fmtSnapshotPct(closedPct)}
          icon={MessageSquareReply}
          variant="info"
          hint="จากเรื่องทั้งหมดในขอบเขตนี้"
        />
        <KPIStat
          label="มีมติพร้อมเหตุผล"
          value={data.decided_with_rationale ?? 0}
          icon={Gavel}
          variant="brand"
          hint="ทุกมติต้องมีเหตุผลกำกับ ระบบไม่รับมติที่ไม่ระบุเหตุผล"
        />
        <KPIStat
          label="สัดส่วนที่มีมติพร้อมเหตุผล"
          value={fmtSnapshotPct(rationalePct)}
          icon={Gavel}
          variant="info"
          hint="จากเรื่องทั้งหมด ไม่ใช่จากเฉพาะเรื่องที่มีมติ"
        />
      </KPIGrid>

      {/* Not measurable yet — the reason is in the block comment above. */}
      <AlertBanner variant="info" title="เกินกำหนด: ยังวัดไม่ได้" className="mt-4">
        ระบบยังไม่มีช่องกรอกกำหนดเสร็จตอนมอบหมายงาน จึงยังไม่มีเรื่องใดที่มีกำหนดให้เกินได้
        — ตัวเลขนี้จะแสดงเมื่อแบบฟอร์มมอบหมายรับกำหนดเสร็จแล้ว
      </AlertBanner>

      <section className="mt-6" aria-label="จำนวนเรื่องแยกตามสถานะ">
        <SectionTitle
          title="แยกตามสถานะ"
          description="เรื่องหนึ่งอยู่ได้สถานะเดียว ผลรวมจึงเท่ากับเรื่องทั้งหมด"
          className="mb-3"
        />
        <AppCard padding="md">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {STATUS_ORDER.map((s) => {
              const style = STATUS_LABEL[s] || { label: s, variant: 'neutral' };
              return (
                <div key={s} className="flex items-center justify-between gap-3 py-2 border-b border-surface-border last:border-b-0">
                  <dt>
                    <StatusBadge variant={style.variant}>{style.label}</StatusBadge>
                  </dt>
                  <dd className="text-sm font-semibold text-ink tabular-nums">{fmtCount(byStatus[s])}</dd>
                </div>
              );
            })}
          </dl>
        </AppCard>
      </section>

      <section className="mt-6" aria-label="จำนวนเรื่องแยกตามประเภท">
        <SectionTitle title="แยกตามประเภทเรื่อง" className="mb-3" />
        <AppCard padding="md">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {Object.entries(CASE_TYPE_LABEL).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-3 py-2 border-b border-surface-border last:border-b-0">
                <dt className="text-sm text-ink">{label}</dt>
                <dd className="text-sm font-semibold text-ink tabular-nums">{fmtCount(byType[key])}</dd>
              </div>
            ))}
          </dl>
        </AppCard>
      </section>

      <section className="mt-6" aria-label="จำนวนเรื่องแยกตามผู้เสนอ">
        <SectionTitle
          title="แยกตามผู้เสนอ"
          description="บทบาทที่ยื่นเรื่องเข้ามา ไม่ใช่บทบาทที่รับผิดชอบ"
          className="mb-3"
        />
        <AppCard padding="md">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {INITIATOR_ROLES.map((r) => (
              <div key={r} className="flex items-center justify-between gap-3 py-2 border-b border-surface-border last:border-b-0">
                <dt className="text-sm text-ink">{ROLE_LABEL[r] || r}</dt>
                <dd className="text-sm font-semibold text-ink tabular-nums">{fmtCount(byRole[r])}</dd>
              </div>
            ))}
          </dl>
        </AppCard>
      </section>
    </div>
  );
}
