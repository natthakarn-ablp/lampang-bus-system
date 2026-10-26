import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Inbox, Plus } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import { StatusBadge, AlertBanner, DataTable, TableAction, FilterBar } from '../../components/ui';
import {
  CASE_TYPE_LABEL, STATUS_LABEL, SCOPE_TYPE_LABEL, ROLE_LABEL, fmtDateTime,
} from './constants';

/**
 * The unified inbox for "งานที่ต้องมีส่วนร่วม".
 *
 * ONE list, not a page per metric. The role-menu audit found the system already
 * has too many entry points and that adding a screen per measure is what made
 * the admin area unusable — the API was built as a single router with one list
 * endpoint for that reason, and the UI follows it.
 *
 * Scope is not a filter here. Every row the API returns is already inside the
 * caller's scope, decided in SQL from the token: a school sees its own cases, an
 * affiliation the schools under it, province and admin everything. There is
 * deliberately no scope selector to imply otherwise.
 */

const OPEN = 'OPEN';
const STATUS_FILTERS = [
  [OPEN, 'ที่ยังไม่จบ'],
  ['SUBMITTED', 'ยื่นเรื่องแล้ว'],
  ['ACKNOWLEDGED', 'รับเรื่องแล้ว'],
  ['IN_CONSULTATION', 'อยู่ระหว่างหารือ'],
  ['DECIDED', 'มีมติแล้ว'],
  ['ASSIGNED', 'มอบหมายแล้ว'],
  ['COMPLETED', 'ดำเนินการเสร็จ'],
  ['CLOSED', 'ปิดเรื่องแล้ว'],
  ['ALL', 'ทั้งหมด'],
];
const TYPE_FILTERS = [['', 'ทุกประเภท'], ...Object.entries(CASE_TYPE_LABEL)];

const PER_PAGE = 20;

export default function ParticipationCases() {
  const navigate = useNavigate();
  const [status, setStatus] = useState(OPEN);
  const [caseType, setCaseType] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // OPEN is not a status the API knows — it is the `open=true` flag, which
      // means "everything still waiting on someone".
      const params = { page, per_page: PER_PAGE };
      if (status === OPEN) params.open = 'true';
      else if (status !== 'ALL') params.status = status;
      if (caseType) params.case_type = caseType;

      const res = await api.get('/participation/cases', { params });
      setRows(Array.isArray(res.data?.data) ? res.data.data : []);
      setTotal(res.data?.meta?.total ?? 0);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดรายการเรื่องไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [status, caseType, page]);

  useEffect(() => { load(); }, [load]);

  // Any filter change starts from page 1: keeping the old page silently shows
  // an empty list when the new filter has fewer pages.
  function changeStatus(next) { setStatus(next); setPage(1); }
  function changeType(next) { setCaseType(next); setPage(1); }

  const columns = [
    {
      key: 'case_no',
      header: 'เลขที่เรื่อง',
      primary: true,
      cell: (r) => <span className="font-medium tabular-nums">{r.case_no}</span>,
    },
    {
      key: 'subject',
      header: 'เรื่อง',
      secondary: true,
      cell: (r) => <span className="line-clamp-2">{r.subject}</span>,
    },
    {
      key: 'case_type',
      header: 'ประเภท',
      cell: (r) => CASE_TYPE_LABEL[r.case_type] || r.case_type,
    },
    {
      key: 'scope',
      header: 'ขอบเขต',
      hideOnMobile: true,
      cell: (r) => `${SCOPE_TYPE_LABEL[r.scope_type] || r.scope_type}${r.scope_id ? ` · ${r.scope_id}` : ''}`,
    },
    {
      key: 'initiated_role',
      header: 'ผู้เสนอ',
      hideOnMobile: true,
      cell: (r) => ROLE_LABEL[r.initiated_role] || r.initiated_role,
    },
    {
      key: 'status',
      header: 'สถานะ',
      badge: true,
      cell: (r) => {
        const s = STATUS_LABEL[r.status] || { label: r.status, variant: 'neutral' };
        return <StatusBadge variant={s.variant}>{s.label}</StatusBadge>;
      },
    },
    {
      key: 'created_at',
      header: 'ยื่นเมื่อ',
      hideOnMobile: true,
      cell: (r) => fmtDateTime(r.created_at),
    },
  ];

  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto motion-safe:animate-fade-in-up motion-reduce:animate-none">
      <PageHeader
        title="เรื่องที่ต้องมีส่วนร่วม"
        subtitle="ข้อเสนอ ข้อกังวล และคำขอที่ต้องมีการรับเรื่อง หารือ ตัดสิน และแจ้งผลกลับ"
        icon={Inbox}
        iconColor="indigo"
        actions={(
          <Link
            to="/participation/new"
            className="focus-ring inline-flex items-center justify-center gap-1.5 bg-brand-700 hover:bg-brand-800 active:bg-brand-900 text-surface-raised text-sm font-medium px-3.5 min-h-[44px] rounded-lg transition"
          >
            <Plus className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
            ยื่นเรื่องใหม่
          </Link>
        )}
      />

      <div className="mt-4">
        <FilterBar
          chips={{
            label: 'สถานะ',
            value: status,
            onChange: changeStatus,
            options: STATUS_FILTERS,
          }}
          filters={[{
            key: 'case_type',
            label: 'ประเภท',
            value: caseType,
            onChange: changeType,
            options: TYPE_FILTERS,
          }]}
        />
      </div>

      {!loading && !error && total > 0 && (
        <p className="mt-3 text-caption text-ink-muted">
          พบ {total.toLocaleString('th-TH')} เรื่อง · หน้า {page} จาก {pageCount}
        </p>
      )}

      <div className="mt-3">
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          error={error}
          onRetry={load}
          caption="รายการเรื่องที่ต้องมีส่วนร่วม"
          empty={{
            title: status === OPEN ? 'ไม่มีเรื่องค้างอยู่' : 'ไม่พบเรื่องตามเงื่อนไขที่เลือก',
            description: status === OPEN
              ? 'ทุกเรื่องได้รับการดำเนินการและแจ้งผลกลับแล้ว'
              : 'ลองเปลี่ยนสถานะหรือประเภทที่กรอง',
          }}
          // A button, not a <Link> wrapping one: a <button> inside an <a> is
          // invalid markup and screen readers announce the pair inconsistently.
          actions={(r) => (
            <TableAction tone="brand" onClick={() => navigate(`/participation/cases/${r.id}`)}>
              ดูรายละเอียด
            </TableAction>
          )}
        />
      </div>

      {pageCount > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2" aria-label="แบ่งหน้า">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="focus-ring min-h-[44px] px-4 rounded-lg border border-surface-border bg-surface-raised text-sm text-ink hover:bg-surface disabled:opacity-40 disabled:pointer-events-none transition"
          >
            ก่อนหน้า
          </button>
          <span className="text-sm text-ink-muted tabular-nums px-2">{page} / {pageCount}</span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page >= pageCount || loading}
            className="focus-ring min-h-[44px] px-4 rounded-lg border border-surface-border bg-surface-raised text-sm text-ink hover:bg-surface disabled:opacity-40 disabled:pointer-events-none transition"
          >
            ถัดไป
          </button>
        </nav>
      )}

      {/* The feature is dark by default. If the router is not mounted every call
          404s, and a bare empty table would read as "no cases" rather than
          "not switched on". */}
      {error && /404/.test(String(error)) && (
        <div className="mt-4">
          <AlertBanner variant="info" title="ยังไม่ได้เปิดใช้งานส่วนนี้">
            ระบบยังไม่ได้เปิด FEATURE_PARTICIPATION_CASES กรุณาติดต่อผู้ดูแลระบบ
          </AlertBanner>
        </div>
      )}
    </div>
  );
}
