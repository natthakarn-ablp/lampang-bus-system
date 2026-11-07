import { Smartphone } from 'lucide-react';
import { useState } from 'react';
import AppCard from '../ui/AppCard';
import { getLiffLaunchUrl, loginWithLineHere, LINE_OA_ID, LINE_OA_URL } from '../../utils/liff';

// Live QA parent-01 / parent-02: a parent page opened in an ordinary browser
// (Chrome, Facebook in-app browser, a desktop) cannot get a LINE identity
// without bouncing to LINE's email/password login. Explain that in Thai and
// offer to reopen the page in the LINE app instead.
//
// subPath is relative to the LIFF endpoint (/parent): '' for /parent,
// '/link' for /parent/link.
export default function OpenInLineCard({ subPath = '', title = 'กรุณาเปิดหน้านี้ในแอป LINE' }) {
  const [busy, setBusy] = useState(false);

  async function onLoginHere() {
    setBusy(true);
    try { await loginWithLineHere(); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <AppCard padding="lg" className="max-w-sm w-full text-center">
        <Smartphone className="w-12 h-12 mx-auto mb-4 text-brand-700" strokeWidth={1.6} aria-hidden="true" />
        <h1 className="text-xl font-semibold text-ink mb-3">{title}</h1>
        <p className="text-base text-ink-muted mb-6">
          ดูเหมือนคุณเปิดลิงก์นี้ในเบราว์เซอร์ภายนอก (เช่น Chrome หรือ Facebook)
          ระบบต้องยืนยันตัวตนผ่านแอป LINE บนมือถือ
        </p>

        <a
          href={getLiffLaunchUrl(subPath)}
          className="focus-ring block w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold min-h-[48px] py-3 rounded-xl transition mb-3"
        >
          เปิดในแอป LINE
        </a>

        <p className="text-sm text-ink-muted mb-4">
          หรือเปิดแชต LINE OA{' '}
          <a href={LINE_OA_URL} className="focus-ring inline-flex items-center min-h-[44px] px-1 text-brand-700 font-semibold underline" target="_blank" rel="noopener noreferrer">
            {LINE_OA_ID}
          </a>{' '}
          (รถรับส่งนักเรียน) แล้วกดลิงก์จากในแชต
        </p>

        <button
          type="button"
          onClick={onLoginHere}
          disabled={busy}
          className="focus-ring min-h-[44px] px-2 text-caption text-ink-muted underline disabled:opacity-50"
        >
          เข้าสู่ระบบ LINE ด้วยอีเมลในเบราว์เซอร์นี้แทน
        </button>
      </AppCard>
    </div>
  );
}
