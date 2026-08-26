import { useState, useEffect, useCallback } from 'react';
import { Calendar, CheckCircle2, Plus } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import EmptyState from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import { AppCard, ConfirmDialog, FormField, StatusBadge } from '../../components/ui';

const TERM_ID_PATTERN = /^\d{4}-[123]$/;
const EMPTY_FORM = { id: '', name: '', start_date: '', end_date: '' };

export default function TermSettings() {
  const toast = useToast();
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);
  // The load error was swallowed, so a failed request showed
  // "ยังไม่มีภาคเรียน" — inviting an admin to create a term that already exists.
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [touchedId, setTouchedId] = useState(false);
  // Switching the current term redirects every new check-in and import, so it
  // gets a dialog that names the term rather than a window.confirm.
  const [confirmTerm, setConfirmTerm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get('/admin/terms');
      setTerms(Array.isArray(r?.data?.data) ? r.data.data : []);
    } catch (e) {
      setError(e.response?.data?.message || 'โหลดรายการภาคเรียนไม่สำเร็จ');
      setTerms([]);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function setCurrent(term) {
    if (busyId) return;
    setBusyId(term.id);
    try {
      await api.post(`/admin/terms/${encodeURIComponent(term.id)}/current`);
      toast.success('ตั้งเป็นภาคเรียนปัจจุบันแล้ว');
      setConfirmTerm(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'ไม่สำเร็จ');
    } finally { setBusyId(null); }
  }

  const idError = touchedId && !TERM_ID_PATTERN.test(form.id.trim())
    ? 'รูปแบบต้องเป็น ปีการศึกษา-ภาคเรียน เช่น 2569-1'
    : undefined;
  const rangeError = form.start_date && form.end_date && form.end_date < form.start_date
    ? 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม'
    : undefined;
  const canSubmit = TERM_ID_PATTERN.test(form.id.trim()) && !rangeError;

  async function addTerm(e) {
    e.preventDefault();
    setTouchedId(true);
    if (!canSubmit) {
      toast.error('รหัสภาคเรียนต้องเป็นรูปแบบ เช่น 2569-1');
      return;
    }
    if (saving) return; // guard the double submit
    setSaving(true);
    try {
      await api.post('/admin/terms', {
        id: form.id.trim(), name: form.name.trim() || null,
        start_date: form.start_date || null, end_date: form.end_date || null,
      });
      toast.success('เพิ่มภาคเรียนแล้ว');
      setForm(EMPTY_FORM);
      setTouchedId(false);
      setShowAdd(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'เพิ่มไม่สำเร็จ');
    } finally { setSaving(false); }
  }

  function cancelAdd() {
    setShowAdd(false);
    setForm(EMPTY_FORM);
    setTouchedId(false);
  }

  return (
    <div className="p-3 sm:p-6 max-w-3xl mx-auto pb-10">
      <PageHeader
        icon={Calendar}
        title="ภาคเรียนปัจจุบัน"
        subtitle="ตั้งภาคเรียนปัจจุบันเพื่อให้การเช็กอิน/นำเข้านักเรียนบันทึกในเทอมที่ถูกต้อง — เปลี่ยนได้ทันทีโดยไม่ต้องรีสตาร์ทระบบ"
        actions={!showAdd && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="focus-ring text-sm font-medium bg-brand-50 hover:bg-brand-100 active:bg-brand-200 text-brand-700 border border-brand-200 px-4 min-h-[44px] rounded-lg transition inline-flex items-center gap-1"
          >
            <Plus className="w-4 h-4" aria-hidden="true" /> เพิ่มภาคเรียน
          </button>
        )}
      />

      {showAdd && (
        <AppCard padding="md" className="mb-5">
          <form onSubmit={addTerm} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField
                label="รหัสภาคเรียน"
                required
                value={form.id}
                onChange={v => setForm({ ...form, id: v })}
                onBlur={() => setTouchedId(true)}
                placeholder="เช่น 2569-1"
                helper="ปีการศึกษา-ภาคเรียน"
                error={idError}
              />
              <FormField
                label="ชื่อ"
                helper="ไม่บังคับ"
                value={form.name}
                onChange={v => setForm({ ...form, name: v })}
                placeholder="ภาคเรียนที่ 1/2569"
              />
              <FormField
                label="วันเริ่ม"
                type="date"
                value={form.start_date}
                onChange={v => setForm({ ...form, start_date: v })}
              />
              <FormField
                label="วันสิ้นสุด"
                type="date"
                value={form.end_date}
                onChange={v => setForm({ ...form, end_date: v })}
                error={rangeError}
              />
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <button
                type="button"
                onClick={cancelAdd}
                className="focus-ring bg-surface hover:bg-surface-border text-ink text-sm font-medium px-4 min-h-[44px] rounded-lg border border-surface-border transition"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={saving}
                className="focus-ring bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-sm font-semibold px-4 min-h-[44px] rounded-lg transition disabled:opacity-50 disabled:pointer-events-none"
              >
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </form>
        </AppCard>
      )}

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState title="โหลดรายการภาคเรียนไม่สำเร็จ" message={error} onRetry={load} />
      ) : terms.length === 0 ? (
        <EmptyState icon={Calendar} title="ยังไม่มีภาคเรียน" description='กด "เพิ่มภาคเรียน" เพื่อเริ่ม' />
      ) : (
        <ul className="space-y-2">
          {terms.map((t) => (
            <li key={t.id}>
              <AppCard
                padding="sm"
                className={`flex flex-wrap items-center justify-between gap-3 ${t.is_current ? 'ring-1 ring-success' : ''}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    {t.id}
                    {t.name ? <span className="text-ink-muted font-normal"> · {t.name}</span> : null}
                  </p>
                  {(t.start_date || t.end_date) && (
                    <p className="text-caption text-ink-muted">
                      {t.start_date ? String(t.start_date).split('T')[0] : '—'} ถึง {t.end_date ? String(t.end_date).split('T')[0] : '—'}
                    </p>
                  )}
                </div>
                {t.is_current ? (
                  <StatusBadge variant="success" icon={CheckCircle2}>ปัจจุบัน</StatusBadge>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmTerm(t)}
                    disabled={busyId === t.id}
                    className="focus-ring shrink-0 text-sm font-medium text-brand-700 border border-brand-200 hover:bg-brand-50 active:bg-brand-100 px-3 min-h-[44px] rounded-lg transition disabled:opacity-50 disabled:pointer-events-none"
                  >
                    ตั้งเป็นปัจจุบัน
                  </button>
                )}
              </AppCard>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(confirmTerm)}
        tone="warn"
        title="ตั้งเป็นภาคเรียนปัจจุบัน?"
        itemName={confirmTerm ? `${confirmTerm.id}${confirmTerm.name ? ` · ${confirmTerm.name}` : ''}` : undefined}
        description="การเช็กอินและการนำเข้านักเรียนหลังจากนี้จะถูกบันทึกในภาคเรียนนี้ ข้อมูลของภาคเรียนก่อนหน้าจะไม่ถูกลบ"
        confirmLabel="ตั้งเป็นปัจจุบัน"
        loading={busyId === confirmTerm?.id}
        onConfirm={() => setCurrent(confirmTerm)}
        onCancel={() => setConfirmTerm(null)}
      />
    </div>
  );
}
