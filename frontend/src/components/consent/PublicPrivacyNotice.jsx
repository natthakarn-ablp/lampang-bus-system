import { useEffect, useState } from 'react';
import axios from 'axios'; // public — no auth

// Phase QR-1 — Level-1 privacy NOTICE (PDPA: notice-only, public-interest basis).
// Acknowledge-only; no opt-in record is required to view Level-1 data.
export default function PublicPrivacyNotice({ onClose }) {
  const [text, setText] = useState(null);
  useEffect(() => {
    axios.get('/api/consent/notice?type=qr_public_notice')
      .then((r) => setText(r.data.data))
      .catch(() => setText({ title: 'ประกาศความเป็นส่วนตัว', body: 'ข้อมูลรถระดับสาธารณะแสดงตามฐานประโยชน์สาธารณะ' }));
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-surface-raised border border-surface-border rounded-xl shadow-elevate w-full max-w-md p-5 sm:p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">{text?.title || 'ประกาศความเป็นส่วนตัว'}</h2>
        <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed mb-5">{text?.body || 'กำลังโหลด…'}</p>
        <button onClick={onClose} className="w-full bg-ink hover:bg-ink/90 text-white text-sm font-medium py-2.5 rounded-lg transition">รับทราบ</button>
      </div>
    </div>
  );
}
