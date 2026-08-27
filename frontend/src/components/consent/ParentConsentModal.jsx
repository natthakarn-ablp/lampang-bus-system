import { useEffect, useState } from 'react';
import axios from 'axios'; // public LIFF — id_token auth, no JWT

// Phase QR-1 — Level-2 parent opt-in. PDPA: explicit consent — the checkbox is
// NOT pre-checked and the confirm button stays disabled until it is ticked.
export default function ParentConsentModal({ idToken, onConsented, onClose }) {
  const [text, setText] = useState(null);
  const [checked, setChecked] = useState(false); // never pre-checked
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    axios.get('/api/consent/notice?type=qr_parent_optin')
      .then((r) => setText(r.data.data))
      .catch(() => setText({ title: 'ความยินยอมสำหรับผู้ปกครอง', body: 'ขอความยินยอมในการแสดงชื่อคนขับและช่องทางติดต่อฉุกเฉิน' }));
  }, []);

  async function confirm() {
    if (!checked) return;
    setBusy(true); setError('');
    try {
      await axios.post('/api/consent/parent', {}, { headers: { Authorization: `Bearer ${idToken}` } });
      onConsented?.();
    } catch (err) { setError(err.response?.data?.message || 'บันทึกความยินยอมไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-surface-raised border border-surface-border rounded-xl shadow-elevate w-full max-w-md p-5 sm:p-6 max-h-[85vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">{text?.title || 'ความยินยอมสำหรับผู้ปกครอง'}</h2>
        <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed mb-4">{text?.body || 'กำลังโหลด…'}</p>

        <label className="flex items-start gap-2.5 mb-4 cursor-pointer">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 accent-blue-600 w-4 h-4" />
          <span className="text-sm text-gray-700">ข้าพเจ้ายินยอมให้แสดงชื่อคนขับและช่องทางติดต่อฉุกเฉิน</span>
        </label>

        {error && <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-sm text-red-700 mb-3">{error}</div>}

        <div className="flex gap-2">
          <button onClick={confirm} disabled={!checked || busy}
            className="focus-ring flex-1 inline-flex items-center justify-center bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium min-h-[44px] rounded-lg transition">
            {busy ? 'กำลังบันทึก…' : 'ยืนยันความยินยอม'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring inline-flex items-center justify-center px-4 min-h-[44px] rounded-lg text-gray-500 hover:text-gray-700 text-sm"
          >
            ไม่ใช่ตอนนี้
          </button>
        </div>
      </div>
    </div>
  );
}
