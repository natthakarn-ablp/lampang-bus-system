import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

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
  const [done, setDone] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [alreadyDone, setAlreadyDone] = useState(false);

  // If today's pretrip is already done, redirect back
  useEffect(() => {
    api.get('/driver/pretrip-status')
      .then(r => {
        if (r.data?.data?.done) { setAlreadyDone(true); }
      })
      .catch(() => {});
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
      toast.error(err.response?.data?.message || 'ไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  }

  // Already done today — show brief confirmation then redirect
  if (alreadyDone && !done) {
    return (
      <div className="p-5 max-w-lg mx-auto text-center py-20">
        <p className="text-5xl mb-4">✅</p>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">ตรวจรถแล้ววันนี้</h2>
        <p className="text-sm text-gray-500 mb-6">สามารถใช้งานระบบได้ทันที</p>
        <button onClick={() => navigate('/driver')}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-lg px-8 py-4 rounded-2xl transition">
          กลับหน้าหลัก
        </button>
      </div>
    );
  }

  // Done state — navigate back
  if (done) {
    return (
      <div className="p-5 max-w-lg mx-auto text-center py-20">
        <p className="text-5xl mb-4">{allPass ? '✅' : '⚠️'}</p>
        <h2 className="text-xl font-semibold text-gray-800 mb-2">
          {allPass ? 'ตรวจรถเรียบร้อย — ออกเดินทางได้' : 'บันทึกรายการผิดปกติแล้ว'}
        </h2>
        <p className="text-sm text-gray-500 mb-6">
          {allPass
            ? 'ผลตรวจถูกบันทึกในระบบแล้ว'
            : 'ระบบได้แจ้งรายการผิดปกติแล้ว กรุณาดำเนินการแก้ไขก่อนออกเดินทาง'}
        </p>
        <button onClick={() => navigate('/driver')}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-lg px-8 py-4 rounded-2xl transition">
          กลับหน้าหลัก
        </button>
      </div>
    );
  }

  // Default: Quick "all pass" mode
  if (!showDetail) {
    return (
      <div className="p-4 sm:p-5 max-w-lg mx-auto pb-8">
        <h1 className="text-xl font-semibold text-gray-800 mb-1">ตรวจรถก่อนออก</h1>
        <p className="text-sm text-gray-500 mb-6">ตรวจสอบความพร้อมของรถก่อนออกรับส่งนักเรียน</p>

        {/* Checklist preview */}
        <div className="bg-white rounded-2xl border-2 border-gray-200 p-5 mb-6">
          <p className="text-sm font-medium text-gray-600 mb-3">รายการตรวจ 6 รายการ:</p>
          <ul className="space-y-2 text-base text-gray-700 mb-4">
            {CHECKLIST.map(c => (
              <li key={c.id} className="flex items-center gap-2">
                <span className="text-green-500 text-lg">✓</span>
                <span>{c.label}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Big "All OK" button */}
        <button onClick={() => handleSubmit(true)} disabled={submitting}
          className="w-full bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold text-xl py-5 rounded-2xl shadow-lg transition disabled:opacity-50 mb-4">
          {submitting ? 'กำลังบันทึก...' : '✅ ทุกรายการปกติ — ออกได้'}
        </button>

        {/* Secondary "has issues" button */}
        <button onClick={() => setShowDetail(true)}
          className="w-full bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold text-lg py-4 rounded-2xl border-2 border-amber-300 transition">
          ⚠️ มีรายการผิดปกติ
        </button>
      </div>
    );
  }

  // Detail mode: toggle items
  return (
    <div className="p-4 sm:p-5 max-w-lg mx-auto pb-8">
      <h1 className="text-xl font-semibold text-gray-800 mb-1">ตรวจรถก่อนออก</h1>
      <p className="text-sm text-gray-500 mb-4">กดรายการที่ <strong>ผิดปกติ</strong> เพื่อระบุปัญหา</p>

      <div className="space-y-2 mb-5">
        {items.map(item => (
          <button key={item.id} onClick={() => toggleItem(item.id)}
            className={`w-full flex items-center gap-3 p-4 rounded-2xl border-2 text-left text-lg font-medium transition ${
              item.ok
                ? 'bg-green-50 border-green-300 text-green-800'
                : 'bg-red-50 border-red-400 text-red-800'
            }`}>
            <span className="text-2xl shrink-0">{item.ok ? '✅' : '❌'}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {/* Note for failed items */}
      {failedItems.length > 0 && (
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            รายละเอียดสิ่งที่ผิดปกติ (ถ้ามี)
          </label>
          <textarea value={note} onChange={e => setNote(e.target.value)}
            rows={3} placeholder="เช่น ยางหลังขวาลมอ่อน..."
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
      )}

      {/* Submit */}
      {failedItems.length > 0 ? (
        <button onClick={() => handleSubmit(false)} disabled={submitting}
          className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold text-lg py-4 rounded-2xl shadow-lg transition disabled:opacity-50 mb-3">
          {submitting ? 'กำลังบันทึก...' : `⚠️ บันทึกรายการผิดปกติ (${failedItems.length} รายการ)`}
        </button>
      ) : (
        <button onClick={() => handleSubmit(true)} disabled={submitting}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold text-lg py-4 rounded-2xl shadow-lg transition disabled:opacity-50 mb-3">
          {submitting ? 'กำลังบันทึก...' : '✅ ทุกรายการปกติ — ออกได้'}
        </button>
      )}

      <button onClick={() => { setShowDetail(false); setItems(CHECKLIST.map(c => ({ ...c, ok: true }))); setNote(''); }}
        className="w-full text-gray-500 hover:text-gray-700 text-base py-3 transition">
        ← กลับ
      </button>
    </div>
  );
}
