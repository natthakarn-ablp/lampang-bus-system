import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import { StatusBadge, AlertBanner, FormField, AppCard } from '../../components/ui';
import {
  ALLOWED_EVENTS, CASE_TYPE_LABEL, DECISION_LABEL, EVENT_LABEL, LIMITS,
  NOTE_REQUIRED, ROLE_LABEL, SCOPE_TYPE_LABEL, STATUS_LABEL, fmtDateTime,
} from './constants';

/**
 * One case, its append-only event log, and the form that adds to it.
 *
 * The log is the point of the whole feature: the system could already record
 * requests and approvals, but nothing proved that a voice was CONSIDERED,
 * ACTED ON and REPORTED BACK. So the timeline is the main content and the
 * form is underneath it, not the other way round.
 *
 * WHAT THIS SCREEN DOES NOT DECIDE
 * Which events are legal from the current status is the server's ruling
 * (participation.service.js ALLOWED_EVENTS, answered as 409 with the allowed
 * list). The select below is narrowed by a client copy of that table so people
 * are not offered nine options and left to discover the rule by being refused —
 * but if the two ever disagree, the server's 409 is what the user sees, and
 * backend/tests/participationClientContract.unit.test.js fails so the drift is
 * caught before a user meets it.
 */

export default function ParticipationCaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [eventType, setEventType] = useState('');
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/participation/cases/${id}`);
      setData(res.data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดรายละเอียดเรื่องไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const allowed = useMemo(
    () => (data ? (ALLOWED_EVENTS[data.status] || []) : []),
    [data]
  );

  // Reset the dependent fields whenever the chosen event changes, so a decision
  // typed for DECIDED is not silently posted with a COMMENTED.
  function chooseEvent(next) {
    setEventType(next);
    setDecision('');
    setAssignedTo('');
  }

  const noteRequired = NOTE_REQUIRED.includes(eventType);

  async function submit(e) {
    e.preventDefault();
    if (!eventType) { toast.error('กรุณาเลือกเหตุการณ์'); return; }
    if (noteRequired && !note.trim()) {
      toast.error(eventType === 'DECIDED' ? 'ต้องระบุเหตุผลของมติ' : 'ต้องระบุสิ่งที่แจ้งกลับผู้เสนอ');
      return;
    }
    if (eventType === 'DECIDED' && !decision) { toast.error('กรุณาเลือกมติ'); return; }
    if (eventType === 'ASSIGNED' && !String(assignedTo).trim()) {
      toast.error('กรุณาระบุผู้รับผิดชอบ'); return;
    }

    setSaving(true);
    try {
      const body = { event_type: eventType, note: note.trim() || null };
      if (evidenceRef.trim()) body.evidence_ref = evidenceRef.trim();
      if (eventType === 'DECIDED') body.decision = decision;
      if (eventType === 'ASSIGNED') body.assigned_to = Number(assignedTo);

      const res = await api.post(`/participation/cases/${id}/events`, body);
      toast.success(res.data.message || 'บันทึกเหตุการณ์สำเร็จ');
      setEventType(''); setNote(''); setDecision(''); setAssignedTo(''); setEvidenceRef('');
      await load();
    } catch (err) {
      // A 409 here is the state machine refusing, and its message names the
      // events that WOULD be accepted. Showing it verbatim is more useful than
      // a generic failure.
      toast.error(err.response?.data?.message || 'บันทึกเหตุการณ์ไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <p className="text-sm text-ink-muted">กำลังโหลด…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <AlertBanner variant="danger" title="เปิดเรื่องนี้ไม่ได้">{error}</AlertBanner>
        <Link
          to="/participation"
          className="focus-ring mt-4 inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-surface-border bg-surface-raised text-sm text-ink hover:bg-surface transition"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          กลับไปรายการ
        </Link>
      </div>
    );
  }

  const statusStyle = STATUS_LABEL[data.status] || { label: data.status, variant: 'neutral' };
  const events = Array.isArray(data.events) ? data.events : [];
  const terminal = allowed.length === 0;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto motion-safe:animate-fade-in-up motion-reduce:animate-none">
      <button
        type="button"
        onClick={() => navigate('/participation')}
        className="focus-ring mb-3 inline-flex items-center gap-1.5 min-h-[44px] px-3 -ml-3 rounded-lg text-sm text-ink-muted hover:text-ink hover:bg-surface transition"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        กลับไปรายการ
      </button>

      <PageHeader
        title={data.subject}
        subtitle={`${data.case_no} · ${CASE_TYPE_LABEL[data.case_type] || data.case_type}`}
        meta={`${SCOPE_TYPE_LABEL[data.scope_type] || data.scope_type}${data.scope_id ? ` ${data.scope_id}` : ''} · ผู้เสนอ: ${ROLE_LABEL[data.initiated_role] || data.initiated_role} · ยื่นเมื่อ ${fmtDateTime(data.created_at)}`}
        icon={MessageSquare}
        iconColor="indigo"
        actions={<StatusBadge variant={statusStyle.variant}>{statusStyle.label}</StatusBadge>}
      />

      {data.body && (
        <AppCard className="mt-4">
          <h2 className="text-sm font-semibold text-ink mb-2">รายละเอียดที่ยื่นมา</h2>
          <p className="text-sm text-ink whitespace-pre-wrap">{data.body}</p>
        </AppCard>
      )}

      {data.decision && (
        <AppCard className="mt-4">
          <h2 className="text-sm font-semibold text-ink mb-1">มติ</h2>
          <p className="text-sm text-ink">
            {DECISION_LABEL[data.decision] || data.decision}
            {data.decided_at ? ` · ${fmtDateTime(data.decided_at)}` : ''}
          </p>
        </AppCard>
      )}

      {/* ── The append-only log ─────────────────────────────────────────── */}
      <section className="mt-6" aria-labelledby="timeline-heading">
        <h2 id="timeline-heading" className="text-sm font-semibold text-ink mb-3">
          ลำดับเหตุการณ์ ({events.length})
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-ink-muted">ยังไม่มีเหตุการณ์</p>
        ) : (
          <ol className="space-y-3">
            {events.map((ev) => (
              <li key={ev.id} className="border-l-2 border-surface-border pl-4 pb-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold text-ink">
                    {EVENT_LABEL[ev.event_type] || ev.event_type}
                  </span>
                  <span className="text-caption text-ink-muted">
                    {ROLE_LABEL[ev.actor_role] || ev.actor_role} · {fmtDateTime(ev.created_at)}
                  </span>
                </div>
                {ev.decision && (
                  <p className="mt-0.5 text-sm text-ink">
                    มติ: {DECISION_LABEL[ev.decision] || ev.decision}
                  </p>
                )}
                {ev.note && <p className="mt-1 text-sm text-ink whitespace-pre-wrap">{ev.note}</p>}
                {ev.evidence_ref && (
                  <p className="mt-1 text-caption text-ink-muted">อ้างอิง: {ev.evidence_ref}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* ── Append ──────────────────────────────────────────────────────── */}
      <section className="mt-6" aria-labelledby="append-heading">
        <h2 id="append-heading" className="text-sm font-semibold text-ink mb-3">บันทึกเหตุการณ์ใหม่</h2>

        {terminal ? (
          <AlertBanner variant="info" title="เรื่องนี้ปิดแล้ว">
            เมื่อปิดเรื่องแล้วจะเพิ่มเหตุการณ์ไม่ได้อีก — บันทึกที่มีอยู่เป็นแบบเพิ่มอย่างเดียว แก้ย้อนหลังไม่ได้
          </AlertBanner>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <FormField label="เหตุการณ์" required>
              {(control) => (
                <select
                  {...control}
                  value={eventType}
                  onChange={(e) => chooseEvent(e.target.value)}
                  className="focus-ring w-full min-h-[44px] px-3 rounded-lg border border-surface-border bg-surface-raised text-base text-ink"
                >
                  <option value="">— เลือกเหตุการณ์ —</option>
                  {allowed.map((t) => (
                    <option key={t} value={t}>{EVENT_LABEL[t] || t}</option>
                  ))}
                </select>
              )}
            </FormField>

            {eventType === 'DECIDED' && (
              <FormField label="มติ" required>
                {(control) => (
                  <select
                    {...control}
                    value={decision}
                    onChange={(e) => setDecision(e.target.value)}
                    className="focus-ring w-full min-h-[44px] px-3 rounded-lg border border-surface-border bg-surface-raised text-base text-ink"
                  >
                    <option value="">— เลือกมติ —</option>
                    {Object.entries(DECISION_LABEL).map(([v, label]) => (
                      <option key={v} value={v}>{label}</option>
                    ))}
                  </select>
                )}
              </FormField>
            )}

            {eventType === 'ASSIGNED' && (
              <FormField
                label="รหัสผู้ใช้ที่รับผิดชอบ"
                required
                type="number"
                inputMode="numeric"
                value={assignedTo}
                onChange={setAssignedTo}
                helper="เลขประจำบัญชีผู้ใช้ในระบบ"
              />
            )}

            <FormField
              label={noteRequired
                ? (eventType === 'DECIDED' ? 'เหตุผลของมติ' : 'สิ่งที่แจ้งกลับผู้เสนอ')
                : 'บันทึกเพิ่มเติม'}
              required={noteRequired}
              helper={`${note.length}/${LIMITS.NOTE} ตัวอักษร`}
            >
              {(control) => (
                <textarea
                  {...control}
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, LIMITS.NOTE))}
                  rows={4}
                  className="focus-ring w-full px-3 py-2 rounded-lg border border-surface-border bg-surface-raised text-base text-ink"
                />
              )}
            </FormField>

            <FormField
              label="อ้างอิงหลักฐาน"
              value={evidenceRef}
              onChange={setEvidenceRef}
              helper="เลขที่หนังสือ ลิงก์ หรือรหัสเอกสาร — ตัวอ้างอิง ไม่ใช่ตัวหลักฐาน"
              placeholder="เช่น บันทึกที่ ลป 0001/2569"
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={saving}
                className="focus-ring inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg bg-brand-700 hover:bg-brand-800 active:bg-brand-900 text-surface-raised text-sm font-semibold transition disabled:opacity-50 disabled:pointer-events-none"
              >
                {saving ? 'กำลังบันทึก…' : 'บันทึกเหตุการณ์'}
              </button>
              <span className="self-center text-caption text-ink-muted">
                บันทึกแล้วแก้ไม่ได้ — ผู้บันทึกคือ {ROLE_LABEL[user?.role] || user?.role}
              </span>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
