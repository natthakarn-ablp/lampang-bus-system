import { useState, useEffect, useCallback, useRef } from 'react';
import { GraduationCap, Plus, Trash2, CheckCircle2, Clock, ChevronDown, Paperclip, Eye, FileText, Users, Check } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import { ConfirmDialog, FormField } from '../../components/ui';

// Deliberately oversized: this page is used one-handed, on a phone, beside
// the bus. FormField wires the label; the size stays.
const BIG_INPUT = 'focus-ring w-full border-2 border-surface-border rounded-2xl px-4 py-4 text-lg text-ink bg-surface-raised transition';

// Elderly / low-tech driver UI: large text, large touch targets (≥56px), the
// fewest possible fields (just name + school + when), plain Thai, and status
// shown as a coloured WORD — never icon-only.

const PICKUP_OPTIONS = [
  { val: 'MORNING', label: 'เฉพาะเช้า' },
  { val: 'EVENING', label: 'เฉพาะเย็น' },
  { val: 'BOTH', label: 'เช้าและเย็น' },
];
const PICKUP_LABEL = { MORNING: 'เฉพาะเช้า', EVENING: 'เฉพาะเย็น', BOTH: 'เช้าและเย็น' };

const APPROVAL = {
  PENDING_SCHOOL_REVIEW: { label: 'รอโรงเรียนตรวจ', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  APPROVED:              { label: 'โรงเรียนรับแล้ว', cls: 'bg-green-100 text-green-800 border-green-300' },
  NEEDS_REVISION:        { label: 'ต้องแก้ไข', cls: 'bg-red-100 text-red-800 border-red-300' },
  REJECTED:              { label: 'ไม่รับ', cls: 'bg-gray-200 text-gray-700 border-gray-300' },
};

function ApprovalPill({ status }) {
  const a = APPROVAL[status] || APPROVAL.PENDING_SCHOOL_REVIEW;
  return <span className={`text-base font-bold px-3 py-1 rounded-full border ${a.cls}`}>{a.label}</span>;
}

export default function DriverVehicleRegistration() {
  const [data, setData] = useState({ vehicle_id: null, eligible: false, schools: [], students: [] });
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  // window.confirm on a phone is a system sheet the driver cannot read
  // alongside the row it refers to.
  const [confirmDelete, setConfirmDelete] = useState(null);
  const toast = useToast();

  const [form, setForm] = useState({
    raw_student_name: '', raw_grade: '', raw_student_code: '', school_id: '', pickup_type: 'BOTH',
  });

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get('/driver/registrations');
      setData(res?.data?.data || { schools: [], students: [] });
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    api.get('/driver/schools').then((r) => {
      const s = r?.data?.data;
      setSchools(Array.isArray(s) ? s : []);
    }).catch(() => {});
  }, [fetchData]);

  function resetForm() {
    setForm({ raw_student_name: '', raw_grade: '', raw_student_code: '', school_id: '', pickup_type: 'BOTH' });
    setShowMore(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.raw_student_name.trim()) { toast.error('กรุณาใส่ชื่อเด็ก'); return; }
    if (!form.school_id) { toast.error('กรุณาเลือกโรงเรียน'); return; }
    setSaving(true);
    try {
      await api.post('/driver/registrations/students', form);
      toast.success('บันทึกแล้ว');
      resetForm();
      setShowForm(false);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'บันทึกไม่ได้ กรุณาลองใหม่');
    } finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if (deletingId) return;
    setDeletingId(id);
    try {
      await api.delete(`/driver/registrations/students/${id}`);
      toast.success('ลบแล้ว');
      setConfirmDelete(null);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ลบไม่ได้');
    } finally { setDeletingId(null); }
  }

  const bySchool = {};
  for (const st of (data.students || [])) {
    (bySchool[st.school_id] = bySchool[st.school_id] || { name: st.school_name, items: [] }).items.push(st);
  }
  const schoolSummary = data.schools || [];
  const approvedCount = schoolSummary.filter((s) => s.approval_status === 'APPROVED').length;

  return (
    <div className="p-4 max-w-xl mx-auto pb-28">
      <PageHeader
        icon={Users}
        title="รายชื่อเด็กในรถ"
        subtitle="ใส่ชื่อเด็กที่ขึ้นรถของคุณ แล้วเลือกโรงเรียน โรงเรียนจะตรวจและรับเข้าระบบ"
      />

      {/* Vehicle ready banner — big and word-based */}
      {!loading && data.vehicle_id && (
        <div className={`rounded-2xl border-2 px-4 py-4 mt-4 flex items-start gap-3 ${data.eligible
          ? 'bg-green-50 border-green-300 text-green-900'
          : 'bg-amber-50 border-amber-300 text-amber-900'}`}>
          {data.eligible
            ? <CheckCircle2 className="w-7 h-7 shrink-0" />
            : <Clock className="w-7 h-7 shrink-0" />}
          <p className="text-lg font-medium leading-snug">
            {data.eligible
              ? 'รถพร้อมใช้งานแล้ว ทุกโรงเรียนรับครบและผ่านการตรวจสภาพ'
              : `โรงเรียนรับแล้ว ${approvedCount} จาก ${schoolSummary.length} โรงเรียน — รอครบทุกโรงเรียนและตรวจสภาพรถ`}
          </p>
        </div>
      )}

      {/* Big add button */}
      {!showForm && (
        <button onClick={() => setShowForm(true)}
          className="w-full mt-5 bg-blue-600 active:bg-blue-700 text-white text-xl font-bold rounded-2xl py-5 flex items-center justify-center gap-2 shadow-sm">
          <Plus className="w-7 h-7" strokeWidth={2.5} /> เพิ่มชื่อเด็ก
        </button>
      )}

      {/* Add form — only 3 things needed */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border-2 border-gray-200 p-5 mt-5 space-y-5">
          {/* The oversized controls are deliberate — this page is used by a
              driver on a phone, often standing beside the bus. FormField only
              supplies the label wiring; the sizing stays as it was. */}
          <FormField label="1. ชื่อเด็ก" labelClassName="text-lg text-ink" required>
            {ctl => (
              <input
                {...ctl}
                type="text"
                value={form.raw_student_name}
                autoFocus
                onChange={(e) => setForm({ ...form, raw_student_name: e.target.value })}
                placeholder="เช่น เด็กชายสมชาย ใจดี"
                className={BIG_INPUT}
              />
            )}
          </FormField>

          <FormField label="2. โรงเรียน" labelClassName="text-lg text-ink" required>
            {ctl => (
              <select
                {...ctl}
                value={form.school_id}
                onChange={(e) => setForm({ ...form, school_id: e.target.value })}
                className={BIG_INPUT}
              >
                <option value="">— แตะเพื่อเลือกโรงเรียน —</option>
                {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </FormField>

          <div>
            {/* One choice from a fixed set — a radiogroup, not three styled
                buttons whose selected state was a fill colour plus a ✓ glyph. */}
            <p id="pickup-type-label" className="block text-lg font-medium text-ink mb-2">3. ขึ้นรถรอบไหน</p>
            <div role="radiogroup" aria-labelledby="pickup-type-label" className="grid grid-cols-1 gap-2">
              {PICKUP_OPTIONS.map((opt) => {
                const on = form.pickup_type === opt.val;
                return (
                  <button
                    key={opt.val}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setForm({ ...form, pickup_type: opt.val })}
                    className={`focus-ring w-full text-lg font-medium rounded-2xl py-4 border-2 transition ${
                      on
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'bg-surface-raised border-surface-border text-ink'
                    }`}
                  >
                    {on && <Check className="inline w-5 h-5 mr-1 -mt-0.5" strokeWidth={3} aria-hidden="true" />}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional details — hidden by default so the form looks short */}
          {!showMore ? (
            <button
              type="button"
              onClick={() => setShowMore(true)}
              aria-expanded={false}
              className="focus-ring text-base text-brand-700 font-medium inline-flex items-center gap-1 px-2 min-h-[44px] rounded-lg hover:bg-brand-50 transition"
            >
              <ChevronDown className="w-5 h-5" aria-hidden="true" /> ใส่ชั้น/รหัสนักเรียน (ถ้าทราบ)
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <FormField label="ชั้น" labelClassName="text-base text-ink-muted">
                {ctl => (
                  <input
                    {...ctl}
                    type="text"
                    value={form.raw_grade}
                    onChange={(e) => setForm({ ...form, raw_grade: e.target.value })}
                    placeholder="เช่น ป.4"
                    className={BIG_INPUT}
                  />
                )}
              </FormField>
              <FormField label="รหัสนักเรียน" labelClassName="text-base text-ink-muted" helper="ถ้าทราบ">
                {ctl => (
                  <input
                    {...ctl}
                    type="text"
                    value={form.raw_student_code}
                    onChange={(e) => setForm({ ...form, raw_student_code: e.target.value })}
                    placeholder="ถ้ามี"
                    className={BIG_INPUT}
                  />
                )}
              </FormField>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="submit" disabled={saving}
              className="flex-1 bg-green-700 active:bg-green-700 disabled:opacity-50 text-white text-xl font-bold rounded-2xl py-4">
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
            <button type="button" onClick={() => { resetForm(); setShowForm(false); }}
              className="px-6 bg-gray-100 active:bg-gray-200 text-gray-700 text-lg font-medium rounded-2xl py-4">
              ยกเลิก
            </button>
          </div>
        </form>
      )}

      {/* Saved list grouped by school */}
      <div className="mt-7">
        {loading ? (
          <LoadingState />
        ) : (data.students || []).length === 0 ? (
          <EmptyState icon={GraduationCap} title="ยังไม่มีรายชื่อเด็ก" description='แตะปุ่ม "เพิ่มชื่อเด็ก" ด้านบนเพื่อเริ่ม' />
        ) : (
          <div className="space-y-6">
            {Object.entries(bySchool).map(([sid, grp]) => (
              <div key={sid}>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-bold text-gray-800">{grp.name}</h2>
                  <span className="text-base text-ink-muted">{grp.items.length} คน</span>
                </div>
                <div className="space-y-3">
                  {grp.items.map((st) => {
                    const locked = st.approval_status === 'APPROVED';
                    return (
                      <div key={st.id} className="bg-white rounded-2xl border-2 border-gray-200 px-4 py-4 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-lg font-medium text-gray-900 truncate">{st.raw_student_name}</p>
                          <p className="text-base text-ink-muted mt-0.5">{PICKUP_LABEL[st.pickup_type] || '-'}</p>
                          <div className="mt-2"><ApprovalPill status={st.approval_status} /></div>
                        </div>
                        {!locked && (
                          <button onClick={() => setConfirmDelete(st)} disabled={deletingId === st.id}
                            className="shrink-0 flex flex-col items-center text-danger-ink active:text-red-800 disabled:opacity-40 px-2 py-1">
                            <Trash2 className="w-7 h-7" />
                            <span className="text-sm font-medium mt-0.5">ลบ</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Vehicle + driver evidence documents */}
      <DriverDocuments />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="ลบชื่อเด็กคนนี้ออกจากรายชื่อ?"
        itemName={confirmDelete?.raw_student_name}
        description="ชื่อนี้จะหายไปจากรายชื่อเด็กในรถของคุณ — ถ้าโรงเรียนรับเข้าระบบแล้ว ข้อมูลของเด็กในระบบจะไม่ถูกลบ"
        confirmLabel="ลบออกจากรายชื่อ"
        loading={deletingId === confirmDelete?.id}
        onConfirm={() => handleDelete(confirmDelete.id)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

// ─── Document attachment (vehicle papers + driver licence) ───────────────────
// Same elderly-friendly rules: big targets, plain Thai words, status as a
// coloured WORD. Attach flow is 2 taps: pick a type → pick a file → auto-upload.
const DOC_TYPES = [
  { kind: 'vehicle', code: 'VEHICLE_REGISTRATION', label: 'เล่มทะเบียนรถ' },
  { kind: 'vehicle', code: 'COMPULSORY_INSURANCE', label: 'พ.ร.บ.' },
  { kind: 'vehicle', code: 'TAX', label: 'ป้ายภาษีรถ' },
  { kind: 'vehicle', code: 'INSURANCE', label: 'ประกันภัยรถ' },
  { kind: 'driver', code: 'DRIVER_LICENCE', label: 'ใบขับขี่' },
  { kind: 'vehicle', code: 'OTHER', label: 'เอกสารอื่น ๆ' },
];
const DOC_LABEL = Object.fromEntries(DOC_TYPES.map((d) => [d.code, d.label]));
const DOC_REVIEW = {
  PENDING: { label: 'รอตรวจ', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  APPROVED: { label: 'ผ่านแล้ว', cls: 'bg-green-100 text-green-800 border-green-300' },
  REJECTED: { label: 'ไม่ผ่าน — แนบใหม่', cls: 'bg-red-100 text-red-800 border-red-300' },
};

function ReviewPill({ status }) {
  const r = DOC_REVIEW[status] || DOC_REVIEW.PENDING;
  return <span className={`text-base font-bold px-3 py-1 rounded-full border ${r.cls}`}>{r.label}</span>;
}

function DriverDocuments() {
  const toast = useToast();
  const fileRef = useRef(null);
  const pendingType = useRef(null);
  const [docs, setDocs] = useState({ vehicle_id: null, vehicle_documents: [], driver_documents: [] });
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [confirmDoc, setConfirmDoc] = useState(null); // doc id being viewed/deleted

  const load = useCallback(async () => {
    try {
      const res = await api.get('/driver/registrations/documents');
      setDocs(res?.data?.data || { vehicle_id: null, vehicle_documents: [], driver_documents: [] });
    } catch { /* ignore — section stays empty */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function chooseType(t) {
    pendingType.current = t;
    setPicking(false);
    if (fileRef.current) { fileRef.current.value = ''; fileRef.current.click(); }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    const t = pendingType.current;
    pendingType.current = null;
    if (!file || !t) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('ไฟล์ต้องไม่เกิน 5 MB'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('doc_type', t.code);
      await api.post(`/driver/registrations/documents/${t.kind}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('แนบเอกสารแล้ว');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'อัปโหลดไม่ได้ กรุณาลองใหม่');
    } finally { setUploading(false); }
  }

  async function viewDoc(kind, id) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await api.get(`/documents/${kind}/${id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error('เปิดเอกสารไม่ได้');
    } finally { setBusyId(null); }
  }

  async function del(kind, id) {
    if (busyId) return;
    setBusyId(id);
    try {
      await api.delete(`/driver/registrations/documents/${kind}/${id}`);
      toast.success('ลบแล้ว');
      setConfirmDoc(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ลบไม่ได้');
    } finally { setBusyId(null); }
  }

  const items = [
    ...(docs.vehicle_documents || []).map((d) => ({ ...d, kind: 'vehicle' })),
    ...(docs.driver_documents || []).map((d) => ({ ...d, kind: 'driver' })),
  ];

  return (
    <div className="mt-10">
      <div className="flex items-center gap-2">
        <FileText className="w-6 h-6 text-gray-700" />
        <h2 className="text-xl font-bold text-gray-900">เอกสารรถและคนขับ</h2>
      </div>
      <p className="text-base text-gray-600 mt-1 leading-relaxed">
        ถ่ายรูปหรือแนบไฟล์ PDF เช่น เล่มทะเบียนรถ พ.ร.บ. ป้ายภาษี ประกัน และใบขับขี่ เพื่อให้โรงเรียนและขนส่งตรวจ
      </p>

      <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden" onChange={onFile} />

      {/* Add button → type picker */}
      {!picking ? (
        <button onClick={() => setPicking(true)} disabled={uploading}
          className="w-full mt-4 bg-blue-600 active:bg-blue-700 disabled:opacity-50 text-white text-xl font-bold rounded-2xl py-5 flex items-center justify-center gap-2 shadow-sm">
          <Paperclip className="w-7 h-7" strokeWidth={2.5} /> {uploading ? 'กำลังอัปโหลด…' : 'แนบเอกสาร'}
        </button>
      ) : (
        <div className="bg-white rounded-2xl border-2 border-gray-200 p-4 mt-4">
          <p className="text-lg font-medium text-gray-800 mb-3">แนบเอกสารอะไร?</p>
          <div className="grid grid-cols-1 gap-2">
            {DOC_TYPES.map((t) => (
              <button key={t.code} onClick={() => chooseType(t)}
                className="w-full text-lg font-medium rounded-2xl py-4 border-2 bg-white border-gray-300 text-gray-700 active:bg-blue-50 active:border-blue-400 text-left px-4">
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={() => setPicking(false)}
            className="w-full mt-3 px-6 bg-gray-100 active:bg-gray-200 text-gray-700 text-lg font-medium rounded-2xl py-3">
            ยกเลิก
          </button>
        </div>
      )}

      {/* Attached list */}
      <div className="mt-5">
        {loading ? (
          <p className="text-base text-ink-muted py-4">กำลังโหลด…</p>
        ) : items.length === 0 ? (
          <p className="text-base text-ink-muted py-4">ยังไม่มีเอกสารแนบ</p>
        ) : (
          <div className="space-y-3">
            {items.map((d) => {
              const locked = d.review_status === 'APPROVED';
              return (
                <div key={`${d.kind}-${d.id}`} className="bg-white rounded-2xl border-2 border-gray-200 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-lg font-medium text-gray-900">{DOC_LABEL[d.doc_type] || 'เอกสาร'}</p>
                      <p className="text-base text-ink-muted mt-0.5 truncate">{d.original_name || '-'}</p>
                      <div className="mt-2"><ReviewPill status={d.review_status} /></div>
                      {d.review_status === 'REJECTED' && d.review_note && (
                        <p className="text-base text-red-700 mt-2 leading-snug">เหตุผล: {d.review_note}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-center gap-3 shrink-0">
                      <button onClick={() => viewDoc(d.kind, d.id)} disabled={busyId === d.id}
                        className="flex flex-col items-center text-blue-600 active:text-blue-800 disabled:opacity-40 px-2">
                        <Eye className="w-7 h-7" />
                        <span className="text-sm font-medium mt-0.5">ดู</span>
                      </button>
                      {!locked && (
                        <button onClick={() => setConfirmDoc(d)} disabled={busyId === d.id}
                          className="flex flex-col items-center text-danger-ink active:text-red-800 disabled:opacity-40 px-2">
                          <Trash2 className="w-7 h-7" />
                          <span className="text-sm font-medium mt-0.5">ลบ</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(confirmDoc)}
        title="ลบเอกสารนี้?"
        itemName={confirmDoc ? (DOC_LABEL[confirmDoc.doc_type] || 'เอกสาร') : undefined}
        description="ไฟล์จะถูกลบออกจากระบบ ต้องแนบใหม่ถ้าโรงเรียนหรือขนส่งขอตรวจอีกครั้ง"
        confirmLabel="ลบเอกสาร"
        loading={busyId === confirmDoc?.id}
        onConfirm={() => del(confirmDoc.kind, confirmDoc.id)}
        onCancel={() => setConfirmDoc(null)}
      />
    </div>
  );
}
