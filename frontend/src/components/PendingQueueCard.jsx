import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, Clock, ArrowUpRight, ChevronDown } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../hooks/useAuth';
import usePendingSummary from '../hooks/usePendingSummary';
import { isGradeTeacher } from '../utils/authScope';
import { useToast } from './Toast';
import AppCard from './ui/AppCard';
import ConfirmDialog from './ui/ConfirmDialog';

// "งานรออนุมัติ" — what is waiting for this role, how long it has waited
// (ค้างนาน after overdue_days), and, for affiliation/province, what the level
// below has left for more than escalate_days. Data: GET /api/<role>/pending-summary.
// No student names: the backend sends request type, plate and school only.

const STUCK_ROLES = ['affiliation', 'transport'];

function AgePill({ item, overdueDays }) {
  if (item.overdue) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn-ink">
        <Clock className="h-3 w-3" aria-hidden="true" />
        ค้างนาน {item.age_days} วัน
      </span>
    );
  }
  return (
    <span className="text-xs text-ink-muted" title={`ถือว่าค้างนานเมื่อเกิน ${overdueDays} วัน`}>
      {item.age_days === 0 ? 'วันนี้' : `${item.age_days} วัน`}
    </span>
  );
}

function QueueRow({ queue, overdueDays }) {
  const [open, setOpen] = useState(false);
  const items = queue.items || [];
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          disabled={!items.length}
          aria-expanded={open}
          className="focus-ring flex min-h-[44px] flex-1 items-center gap-2 rounded-lg px-1 text-left text-sm text-ink disabled:cursor-default"
        >
          {items.length > 0 && (
            <ChevronDown className={`h-4 w-4 shrink-0 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          )}
          <span className="flex-1">{queue.label}</span>
          <span className={`min-w-[28px] rounded-full px-2 py-0.5 text-center text-xs font-semibold ${queue.count ? 'bg-brand-50 text-brand-700' : 'text-ink-muted'}`}>
            {queue.count}
          </span>
          {queue.overdue > 0 && (
            <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn-ink">
              ค้างนาน {queue.overdue}
            </span>
          )}
        </button>
        {queue.link && queue.count > 0 && (
          <Link to={queue.link} className="focus-ring inline-flex min-h-[44px] items-center gap-1 rounded-lg px-2 text-sm font-semibold text-brand-700 hover:underline">
            ไปดำเนินการ <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>
      {open && items.length > 0 && (
        <ul className="mt-1 space-y-1 pl-7">
          {items.slice(0, 10).map(item => (
            <li key={item.item_id}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm`}>
              <span className="text-ink">
                {item.title}
                {item.school_name && <span className="text-ink-muted"> · {item.school_name}</span>}
              </span>
              <AgePill item={item} overdueDays={overdueDays} />
            </li>
          ))}
          {items.length > 10 && <li className="px-2 text-xs text-ink-muted">และอีก {items.length - 10} รายการ</li>}
        </ul>
      )}
    </li>
  );
}

function StuckApplications({ onChanged }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => (
    api.get('/verification/oversight/applications/stuck')
      .then(r => setData(r.data?.data || null))
      .catch(() => setData(null))
  ), []);
  useEffect(() => { load(); }, [load]);

  async function cancel() {
    if (!target || reason.trim().length < 5) return;
    setBusy(true);
    try {
      await api.post(`/verification/oversight/applications/${target.id}/cancel`, { reason: reason.trim() });
      toast.success('ยกเลิกคำขอแทนโรงเรียนแล้ว');
      setTarget(null);
      setReason('');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ยกเลิกคำขอไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  const rows = data?.rows || [];
  if (!rows.length) return null;
  return (
    <div className="mt-4 border-t border-surface-border pt-3">
      <p className="text-sm font-semibold text-ink">คำขอส่งตรวจรถที่ไม่มีความเคลื่อนไหว {data.stuck_days} วันขึ้นไป</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        รถหนึ่งคันมีคำขอได้หนึ่งรายการต่อภาคเรียน ถ้าโรงเรียนไม่ดำเนินการต่อ ยกเลิกแทนได้พร้อมระบุเหตุผล (บันทึกในประวัติการแก้ไข)
      </p>
      <ul className="mt-2 divide-y divide-surface-border">
        {rows.slice(0, 20).map(row => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="text-ink">
              รถ {row.plate_no} · {row.issuing_school_name}
              <span className="text-ink-muted"> · {row.request_no} · ค้าง {row.idle_days} วัน</span>
            </span>
            <button type="button" onClick={() => { setReason(''); setTarget(row); }}
              className="focus-ring min-h-[44px] rounded-lg border border-danger px-3 text-sm font-semibold text-danger-ink">
              ยกเลิกคำขอแทนโรงเรียน
            </button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!target}
        title="ยกเลิกคำขอส่งตรวจรถนี้?"
        description="โรงเรียนจะสร้างคำขอใหม่ให้รถคันนี้ได้หลังยกเลิก การตรวจที่ค้างอยู่ (ถ้ามี) จะถูกล้าง"
        itemName={target ? `รถ ${target.plate_no} (${target.request_no})` : undefined}
        confirmLabel="ยกเลิกคำขอ"
        cancelLabel="ไม่ยกเลิก"
        loading={busy}
        confirmDisabled={reason.trim().length < 5}
        onConfirm={cancel}
        onCancel={() => { setTarget(null); setReason(''); }}
      >
        <label className="block text-sm font-medium text-ink" htmlFor="stuck-cancel-reason">
          เหตุผล (พิมพ์ 5 ตัวอักษรขึ้นไป)
        </label>
        <textarea id="stuck-cancel-reason" value={reason} maxLength={500}
          onChange={e => setReason(e.target.value)}
          className="focus-ring mt-1 min-h-[88px] w-full rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-base sm:text-sm text-ink"
          placeholder="เช่น โรงเรียนแจ้งว่ารถคันนี้เลิกให้บริการแล้ว" />
      </ConfirmDialog>
    </div>
  );
}

// Province only (owner decision 2026-11-13): an affiliation request that has
// waited escalate_days or more can be decided here on the affiliation's behalf.
// POST /api/province/escalated/<transfer-requests|vehicle-requests>/:id/<approve|reject>
// — the backend refuses younger items (409) and audits the override.
const OVERRIDE_PATH = { transfer_internal: 'transfer-requests', vehicle_requests: 'vehicle-requests' };

function EscalatedDecision({ item, onDone }) {
  const toast = useToast();
  const [decision, setDecision] = useState(null); // 'approve' | 'reject'
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const segment = OVERRIDE_PATH[item.queue];
  if (!segment || !item.escalated) return null;
  const needsReason = decision === 'reject';

  async function submit() {
    if (!decision || (needsReason && !reason.trim())) return;
    setBusy(true);
    try {
      const res = await api.post(`/province/escalated/${segment}/${encodeURIComponent(item.item_id)}/${decision}`,
        { reason: reason.trim() });
      const status = res.data?.data?.status;
      const ok = decision === 'reject' || status === 'APPLIED';
      (ok ? toast.success : toast.error)(res.data?.message || 'บันทึกแล้ว');
      setDecision(null);
      setReason('');
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
        <button type="button" onClick={() => { setReason(''); setDecision('approve'); }}
          className="focus-ring min-h-[44px] rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white">
          อนุมัติ
        </button>
        <button type="button" onClick={() => { setReason(''); setDecision('reject'); }}
          className="focus-ring min-h-[44px] rounded-lg border border-danger px-3 text-sm font-semibold text-danger-ink">
          ไม่อนุมัติ
        </button>
      </div>
      <ConfirmDialog
        open={!!decision}
        tone={decision === 'reject' ? 'danger' : 'brand'}
        title={decision === 'reject' ? 'ไม่อนุมัติคำขอนี้แทนสังกัด?' : 'อนุมัติคำขอนี้แทนสังกัด?'}
        description={`คำขอนี้รอสังกัดพิจารณามา ${item.age_days} วัน ผลจะเหมือนสังกัดเป็นผู้พิจารณา และบันทึกว่าจังหวัดพิจารณาแทน`}
        itemName={`${item.queue_label} · ${item.title}${item.school_name ? ` · ${item.school_name}` : ''}`}
        confirmLabel={decision === 'reject' ? 'ไม่อนุมัติ' : 'อนุมัติ'}
        cancelLabel="ยกเลิก"
        loading={busy}
        confirmDisabled={needsReason && !reason.trim()}
        onConfirm={submit}
        onCancel={() => { if (!busy) { setDecision(null); setReason(''); } }}
      >
        <label className="block text-sm font-medium text-ink" htmlFor={`esc-reason-${item.queue}-${item.item_id}`}>
          {needsReason ? 'เหตุผลที่ไม่อนุมัติ (จำเป็น)' : 'หมายเหตุ (ไม่บังคับ)'}
        </label>
        <textarea id={`esc-reason-${item.queue}-${item.item_id}`} value={reason} maxLength={500}
          onChange={e => setReason(e.target.value)}
          className="focus-ring mt-1 min-h-[88px] w-full rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-base sm:text-sm text-ink"
          placeholder={needsReason ? 'เช่น ข้อมูลโรงเรียนปลายทางไม่ถูกต้อง' : 'เช่น สังกัดไม่ได้พิจารณาภายในกำหนด'} />
      </ConfirmDialog>
    </>
  );
}

export default function PendingQueueCard({ className = '' }) {
  const { user } = useAuth();
  const role = user?.role;
  const teacher = isGradeTeacher(user);
  const { data, reload } = usePendingSummary(role, { detail: true, enabled: !teacher, pollMs: 0 });

  if (teacher || !data) return null;
  const escalated = data.escalated?.items || [];
  const hasOwn = (data.queues || []).length > 0;

  return (
    <AppCard padding="md" className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <Inbox className="h-5 w-5 text-brand-700" aria-hidden="true" />
        <h2 className="text-base font-semibold text-ink">งานรออนุมัติ</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${data.total ? 'bg-brand-50 text-brand-700' : 'text-ink-muted'}`}>
          {data.total}
        </span>
        {data.overdue_total > 0 && (
          <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn-ink">
            ค้างนาน {data.overdue_total}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        ค้างนาน = รอเกิน {data.overdue_days} วัน · รอเกิน {data.escalate_days} วันจะแจ้งหน่วยงานระดับถัดไป
      </p>

      {hasOwn && (
        <ul className="mt-2 divide-y divide-surface-border">
          {data.queues.map(q => <QueueRow key={q.key} queue={q} overdueDays={data.overdue_days} />)}
        </ul>
      )}

      {escalated.length > 0 && (
        <div className="mt-4 border-t border-surface-border pt-3">
          <p className="text-sm font-semibold text-ink">
            เรื่องที่หน่วยงานระดับล่างค้างเกิน {data.escalate_days} วัน ({data.escalated.count})
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {role === 'province'
              ? `โปรดติดตามกับหน่วยงานที่รับผิดชอบ · คำขอโอนย้ายในสังกัดและคำขอเกี่ยวกับรถ จังหวัดอนุมัติหรือไม่อนุมัติแทนสังกัดได้เมื่อรอครบ ${data.escalate_days} วัน`
              : 'โปรดติดตามกับหน่วยงานที่รับผิดชอบ'}
          </p>
          <ul className="mt-2 space-y-1">
            {escalated.slice(0, 20).map(item => (
              <li key={`${item.queue}-${item.item_id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-l-4 border-warn px-2 py-1.5 text-sm">
                <span className="text-ink">
                  {item.queue_label} · {item.title}
                  {item.school_name && <span className="text-ink-muted"> · {item.school_name}</span>}
                </span>
                <AgePill item={item} overdueDays={data.overdue_days} />
                {role === 'province' && <EscalatedDecision item={item} onDone={reload} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasOwn && !escalated.length && (
        <p className="mt-2 text-sm text-ink-muted">ไม่มีงานค้าง</p>
      )}
      {hasOwn && data.total === 0 && (
        <p className="mt-1 text-sm text-ink-muted">ไม่มีงานค้าง</p>
      )}

      {STUCK_ROLES.includes(role) && <StuckApplications onChanged={reload} />}
    </AppCard>
  );
}
