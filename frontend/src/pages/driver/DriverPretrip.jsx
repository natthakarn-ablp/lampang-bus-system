import { CheckCircle2, XCircle, Check, AlertTriangle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { FormField } from '../../components/ui';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import { useToast } from '../../components/Toast';
import { isDriverNotLinked, driverErrorMessage } from '../../utils/driverErrors';

const CHECKLIST = [
  { id: 'tires', label: 'ยางรถ / ลมยาง' },
  { id: 'lights', label: 'ไฟหน้า-ไฟท้าย' },
  { id: 'mirrors', label: 'กระจก / กระจกมองข้าง' },
  { id: 'brakes', label: 'เบรก' },
  { id: 'seatbelts', label: 'เข็มขัดนิรภัย / ที่นั่ง' },
  { id: 'clean', label: 'ความสะอาดภายในรถ' },
];

export default function DriverPretrip() {
  const navigate = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState(() => CHECKLIST.map(c => ({ ...c, ok: true })));
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [notLinked, setNotLinked] = useState(false);

  // If today's pretrip is already done, redirect back
  useEffect(() => {
    setLoading(true);
    api.get('/driver/pretrip-status')
      .then(r => {
        if (r.data?.data?.done) { setAlreadyDone(true); }
      })
      .catch((err) => {
        // บัญชียังไม่ผูกรถ: บอกตั้งแต่ต้น อย่าปล่อยให้ติ๊กครบ 6 ข้อแล้วค่อย
        // ล้มเหลวตอนกดบันทึก — เสียเวลาคนขับฟรีและข้อความที่ได้ก็อ่านไม่ออก
        if (isDriverNotLinked(err)) setNotLinked(true);
        /* ข้อผิดพลาดอื่น: ให้ทำรายการตรวจต่อได้ตามเดิม */
      })
      .finally(() => setLoading(false));
  }, []);

  const allPass = items.every(i => i.ok);
  const failedItems = items.filter(i => !i.ok);

  function toggleItem(id) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, ok: !i.ok } : i));
  }

  async function handleSubmit(forceAllPass = false) {
    setSubmitting(true);
    try {
      const submitItems = forceAllPass
        ? CHECKLIST.map(c => ({ label: c.label, ok: true }))
        : items.map(i => ({ label: i.label, ok: i.ok }));

      await api.post('/driver/pretrip', {
        all_pass: forceAllPass || allPass,
        items: submitItems,
        note: forceAllPass ? null : (note || null),
      });

      toast.success('บันทึกผลตรวจรถสำเร็จ');
      setDone(true);
    } catch (err) {
      if (isDriverNotLinked(err)) setNotLinked(true);
      else toast.error(driverErrorMessage(err, 'บันทึกผลตรวจไม่สำเร็จ'));
    } finally {
      setSubmitting(false);
    }
  }

  // Already done today — show brief confirmation then redirect
  if (alreadyDone && !done) {
    return (
      <div className="p-5 max-w-lg mx-auto py-16">
        <EmptyState
          icon={CheckCircle2}
          variant="success"
          title="ตรวจรถแล้ววันนี้"
          description="สามารถใช้งานระบบได้ทันที"
          action={
            <button onClick={() => navigate('/driver')} className="focus-ring bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-semibold text-lg px-8 min-h-[56px] rounded-2xl transition">
              กลับหน้าหลัก
            </button>
          }
        />
      </div>
    );
  }

  // Done state — navigate back
  if (done) {
    return (
      <div className="p-5 max-w-lg mx-auto py-16">
        <EmptyState
          icon={allPass ? CheckCircle2 : AlertTriangle}
          variant={allPass ? 'success' : 'warn'}
          title={allPass ? 'ตรวจรถเรียบร้อย — ออกเดินทางได้' : 'บันทึกรายการผิดปกติแล้ว'}
          description={allPass
            ? 'ผลตรวจถูกบันทึกในระบบแล้ว'
            : 'ระบบได้แจ้งรายการผิดปกติแล้ว กรุณาดำเนินการแก้ไขก่อนออกเดินทาง'}
          action={
            <button onClick={() => navigate('/driver')} className="focus-ring bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-semibold text-lg px-8 min-h-[56px] rounded-2xl transition">
              กลับหน้าหลัก
            </button>
          }
        />
      </div>
    );
  }

  // The status probe decides whether this driver has already completed today's
  // pre-trip, so the checklist must not flash before it answers.
  if (loading) return <LoadingState />;

  // บัญชียังไม่ผูกรถ — บันทึกผลตรวจไม่ได้เพราะระบบไม่รู้ว่าตรวจรถคันไหน
  if (notLinked) {
    return (
      <div className="p-4 sm:p-5 max-w-lg mx-auto pb-8">
        <PageHeader title="ตรวจรถก่อนออก" />
        <EmptyState
          icon={AlertTriangle}
          title="บัญชีนี้ยังไม่ได้ผูกกับรถ"
          description="ระบบยังไม่ทราบว่าคุณขับรถคันไหน จึงบันทึกผลตรวจให้ไม่ได้ กรุณาแจ้งโรงเรียนที่คุณรับส่งนักเรียน เพื่อผูกบัญชีของคุณกับทะเบียนรถที่ขับ แล้วเข้าสู่ระบบใหม่อีกครั้ง"
          action={(
            <button
              type="button"
              onClick={() => navigate('/driver')}
              className="focus-ring inline-flex min-h-[48px] items-center justify-center rounded-xl bg-brand-600 px-6 font-semibold text-white transition hover:bg-brand-700"
            >
              กลับหน้าแรก
            </button>
          )}
        />
      </div>
    );
  }

  // Default: Quick "all pass" mode
  if (!showDetail) {
    return (
      <div className="p-4 sm:p-5 max-w-lg mx-auto pb-8">
        <PageHeader
          title="ตรวจรถก่อนออก"
          subtitle="ตรวจสอบความพร้อมของรถก่อนออกรับส่งนักเรียน"
        />

        {/* Checklist preview */}
        <div className="bg-white rounded-2xl border-2 border-gray-200 p-5 mb-6">
          <p className="text-sm font-medium text-gray-600 mb-3">รายการตรวจ 6 รายการ:</p>
          <ul className="space-y-2 text-base text-gray-700 mb-4">
            {CHECKLIST.map(c => (
              <li key={c.id} className="flex items-center gap-2">
                <Check className="w-4 h-4 text-success-ink" strokeWidth={2.4} aria-hidden="true" />
                <span>{c.label}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Big "All OK" button */}
        <button onClick={() => handleSubmit(true)} disabled={submitting}
          className="w-full bg-green-700 hover:bg-green-800 active:bg-green-900 text-white font-semibold text-xl py-5 rounded-2xl shadow-lg transition disabled:opacity-50 mb-4">
          {submitting ? 'กำลังบันทึก...' : 'ทุกรายการปกติ — ออกได้'}
        </button>

        {/* Secondary "has issues" button */}
        <button onClick={() => setShowDetail(true)}
          className="w-full bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold text-lg py-4 rounded-2xl border-2 border-amber-300 transition">
          มีรายการผิดปกติ
        </button>
      </div>
    );
  }

  // Detail mode: toggle items
  return (
    <div className="p-4 sm:p-5 max-w-lg mx-auto pb-8">
      <h2 className="text-xl font-semibold text-ink mb-1">ตรวจรถก่อนออก</h2>
      <p className="text-sm text-ink-muted mb-4">กดรายการที่ <strong>ผิดปกติ</strong> เพื่อระบุปัญหา</p>

      <div className="space-y-2 mb-5">
        {items.map(item => (
          <button key={item.id} type="button" onClick={() => toggleItem(item.id)} aria-pressed={!item.ok}
            className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 text-left text-lg font-medium transition ${
              item.ok
                ? 'bg-green-50 border-green-300 text-green-800'
                : 'bg-red-50 border-red-400 text-red-800'
            }`}>
            {/* The emoji was the whole state: a screen reader announced
                 "white heavy check mark" and a colour-blind reader had only
                 the green/red fill to go on. */}
            {item.ok
              ? <CheckCircle2 className="w-7 h-7 shrink-0 text-success-ink" strokeWidth={2.2} aria-hidden="true" />
              : <XCircle className="w-7 h-7 shrink-0 text-danger-ink" strokeWidth={2.2} aria-hidden="true" />}
            <span>{item.label}</span>
            <span className="sr-only">{item.ok ? '— ปกติ' : '— ผิดปกติ'}</span>
          </button>
        ))}
      </div>

      {/* Note for failed items */}
      {failedItems.length > 0 && (
        <FormField className="mb-5" label="รายละเอียดสิ่งที่ผิดปกติ" helper="ไม่บังคับ">
          {ctl => (
            <textarea {...ctl} value={note} onChange={e => setNote(e.target.value)}
              rows={3} placeholder="เช่น ยางหลังขวาลมอ่อน…"
              className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 py-2.5 text-base text-ink placeholder:text-ink-muted transition" />
          )}
        </FormField>
      )}

      {/* Submit */}
      {failedItems.length > 0 ? (
        <button onClick={() => handleSubmit(false)} disabled={submitting}
          className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold text-lg py-4 rounded-2xl shadow-lg transition disabled:opacity-50 mb-3">
          {submitting ? 'กำลังบันทึก...' : `บันทึกรายการผิดปกติ (${failedItems.length} รายการ)`}
        </button>
      ) : (
        <button onClick={() => handleSubmit(true)} disabled={submitting}
          className="w-full bg-green-700 hover:bg-green-800 text-white font-semibold text-lg py-4 rounded-2xl shadow-lg transition disabled:opacity-50 mb-3">
          {submitting ? 'กำลังบันทึก...' : 'ทุกรายการปกติ — ออกได้'}
        </button>
      )}

      <button onClick={() => { setShowDetail(false); setItems(CHECKLIST.map(c => ({ ...c, ok: true }))); setNote(''); }}
        className="w-full text-ink-muted hover:text-gray-700 text-base py-3 transition">
        ← กลับ
      </button>
    </div>
  );
}
