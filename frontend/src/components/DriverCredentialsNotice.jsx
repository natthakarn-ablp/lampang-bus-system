import { useToast } from './Toast';

/**
 * DriverCredentialsNotice — shown once, right after a vehicle save created a
 * driver login (swt-07 / SEED-F1, live QA 2026-11).
 *
 * The temporary password is random and the server keeps only its hash, so
 * this card is the school's only chance to see it. It lives in component
 * state only: leaving or reloading the page drops it on purpose.
 */
export default function DriverCredentialsNotice({ username, temporaryPassword }) {
  const toast = useToast();
  if (!username || !temporaryPassword) return null;

  async function copy() {
    const text = `ชื่อผู้ใช้: ${username}\nรหัสผ่านชั่วคราว: ${temporaryPassword}\nเข้าสู่ระบบที่ https://schoolbuslampang.com แล้วเปลี่ยนรหัสผ่านใหม่`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('คัดลอกชื่อผู้ใช้และรหัสผ่านแล้ว');
    } catch {
      toast.error('คัดลอกอัตโนมัติไม่ได้ กรุณาจดชื่อผู้ใช้และรหัสผ่านด้วยตนเอง');
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-warn/40 bg-surface-raised p-3" role="note" aria-label="บัญชีคนขับที่สร้างใหม่">
      <p className="text-sm font-semibold text-ink">สร้างบัญชีคนขับแล้ว</p>
      <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-muted">ชื่อผู้ใช้</dt>
        <dd className="font-medium text-ink break-all">{username}</dd>
        <dt className="text-ink-muted">รหัสผ่านชั่วคราว</dt>
        <dd className="font-mono text-base font-semibold tracking-wider text-ink break-all">{temporaryPassword}</dd>
      </dl>
      <p className="mt-2 text-sm text-warn-ink">
        กรุณาส่งชื่อผู้ใช้และรหัสผ่านนี้ให้คนขับ รหัสผ่านจะแสดงเพียงครั้งนี้ครั้งเดียว
        คนขับต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก
      </p>
      <button
        type="button"
        onClick={copy}
        className="focus-ring mt-2 inline-flex items-center min-h-[44px] px-4 rounded-lg border border-brand-200 bg-brand-50 hover:bg-brand-100 text-brand-700 text-sm font-medium transition"
      >
        คัดลอกชื่อผู้ใช้และรหัสผ่าน
      </button>
    </div>
  );
}
