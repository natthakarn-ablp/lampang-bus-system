import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Lock, WifiOff, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/Toast';
import { ROLE_HOME } from '../App';

// Token-based styles for each error class. Full border + soft semantic
// background + readable ink (DESIGN.md: status is never color-only and never a
// decorative left bar).
const ERROR_STYLE = {
  rate:     { wrap: 'bg-warn-soft   border-warn/40   text-amber-900', Icon: Clock },
  disabled: { wrap: 'bg-surface     border-surface-border text-ink',  Icon: Lock },
  network:  { wrap: 'bg-info-soft   border-info/40   text-sky-900',   Icon: WifiOff },
  auth:     { wrap: 'bg-danger-soft border-danger/40 text-red-900',   Icon: AlertTriangle },
  server:   { wrap: 'bg-danger-soft border-danger/40 text-red-900',   Icon: AlertTriangle },
};

const FIELD_CLASS =
  'w-full min-h-[48px] rounded-2xl border border-surface-border bg-surface-raised px-4 py-3 ' +
  'text-lg font-semibold text-ink placeholder:text-ink-muted/70 shadow-sm transition-colors duration-150 ' +
  'focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/15';

const BRAND_LOGO = '/brand/school-safe-logo.jpg';
const BRAND_BANNER = '/brand/school-safe-banner.png';

export default function Login() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const toast     = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState(null); // { msg, hint?, type? }
  const [loading,  setLoading]  = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await login(username.trim(), password);
      if (user.must_change_password) {
        toast.success('กรุณาเปลี่ยนรหัสผ่านเริ่มต้น');
        navigate('/change-password', { replace: true });
        return;
      }
      toast.success('เข้าสู่ระบบสำเร็จ');
      navigate(ROLE_HOME[user.role] || '/', { replace: true });
    } catch (err) {
      const status = err.response?.status;
      const serverMsg = err.response?.data?.message || '';

      if (status === 429) {
        setError({
          msg: 'มีการพยายามเข้าสู่ระบบหลายครั้งจากเครือข่ายนี้',
          hint: 'ระบบระงับชั่วคราวเพื่อความปลอดภัย กรุณาลองใหม่อีกประมาณ 15 นาที\nบัญชีของคุณไม่ได้ถูกปิดใช้งานถาวร',
          type: 'rate',
        });
      } else if (status === 401 && serverMsg.toLowerCase().includes('disabled')) {
        setError({
          msg: 'บัญชีนี้ถูกปิดการใช้งาน',
          hint: 'กรุณาติดต่อผู้ดูแลระบบ',
          type: 'disabled',
        });
      } else if (status === 401) {
        setError({
          msg: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
          type: 'auth',
        });
      } else if (!err.response) {
        setError({
          msg: 'ไม่สามารถเชื่อมต่อระบบได้',
          hint: 'กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง',
          type: 'network',
        });
      } else {
        setError({
          msg: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
          type: 'server',
        });
      }
    } finally {
      setLoading(false);
    }
  }

  const errStyle = error ? (ERROR_STYLE[error.type] || ERROR_STYLE.server) : null;

  return (
    <div className="min-h-screen overflow-hidden bg-slate-50 text-ink">
      <div
        className="pointer-events-none fixed inset-0 opacity-70"
        aria-hidden="true"
        style={{
          backgroundImage:
            'linear-gradient(90deg, rgba(37,99,235,0.07) 1px, transparent 1px), linear-gradient(rgba(37,99,235,0.07) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
        }}
      />

      <div className="relative flex min-h-screen items-center justify-center px-4 py-8 sm:px-6 lg:px-10">
        <div className="grid w-full max-w-6xl overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-2xl shadow-brand-900/10 motion-safe:animate-scale-in lg:grid-cols-[1.08fr_0.92fr]">
          <section className="relative hidden min-h-[640px] bg-brand-900 p-10 text-white lg:block">
            <div className="absolute inset-0" aria-hidden="true">
              <div className="absolute left-[-10%] top-[-14%] h-96 w-96 rounded-full bg-info/20 blur-3xl" />
              <div className="absolute bottom-[-18%] right-[-10%] h-[28rem] w-[28rem] rounded-full bg-brand-600/20 blur-3xl" />
              <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-slate-950/45 to-transparent" />
            </div>

            <div className="relative z-10 flex h-full flex-col justify-between">
              <div>
                <div className="inline-flex items-center gap-3 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-sm font-semibold text-blue-50 backdrop-blur">
                  <img
                    src={BRAND_LOGO}
                    alt=""
                    className="h-10 w-10 rounded-full border border-white/60 bg-white object-cover"
                  />
                  ระบบรถรับส่งนักเรียนจังหวัดลำปาง
                </div>

                <div className="mt-10 overflow-hidden rounded-[24px] border border-white/30 bg-white shadow-2xl shadow-slate-950/30">
                  <img
                    src={BRAND_BANNER}
                    alt="ระบบรถรับส่งนักเรียนจังหวัดลำปาง เดินทางปลอดภัย อุ่นใจทุกเส้นทาง"
                    className="aspect-[16/7] w-full object-cover"
                  />
                </div>

                <div className="mt-8 max-w-xl">
                  <p className="text-base font-semibold text-cyan-100">อุ่นใจไปโรงเรียน</p>
                  <h1 className="mt-3 text-4xl font-black leading-tight tracking-normal">
                    ทุกการเดินทางของนักเรียน
                    <span className="mt-2 block text-3xl text-cyan-100">ต้องปลอดภัย ตรวจสอบได้ และอุ่นใจทุกคน</span>
                  </h1>
                  <p className="mt-5 max-w-lg text-lg leading-8 text-blue-50">
                    ใช้ติดตามข้อมูลรถรับส่ง นักเรียน คนขับ ผู้ปกครอง โรงเรียน ต้นสังกัด และรายงานการเดินทางในจังหวัดลำปาง
                  </p>
                </div>
              </div>

              <div className="relative mt-8 rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    ['6', 'สิทธิ์ผู้ใช้งาน'],
                    ['ตรวจสอบ', 'ข้อมูลย้อนหลัง'],
                    ['แจ้งเตือน', 'ถึงผู้ปกครอง'],
                  ].map(([value, label]) => (
                    <div key={label} className="rounded-xl bg-white/10 p-4">
                      <p className="text-2xl font-black text-white">{value}</p>
                      <p className="mt-1 text-sm text-blue-100">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <main className="relative bg-surface-raised px-5 py-8 sm:px-10 lg:px-12 lg:py-14">
            <div className="mx-auto flex w-full max-w-md flex-col">
              <div className="mb-8 lg:hidden">
                <div className="inline-flex items-center gap-3 rounded-full bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-900">
                  <img
                    src={BRAND_LOGO}
                    alt=""
                    className="h-9 w-9 rounded-full border border-brand-100 bg-white object-cover"
                  />
                  รถรับส่งนักเรียนลำปาง
                </div>
                <div className="mt-5 overflow-hidden rounded-3xl border border-brand-100 bg-brand-50 shadow-lg shadow-brand-900/10">
                  <img
                    src={BRAND_BANNER}
                    alt="ระบบรถรับส่งนักเรียนจังหวัดลำปาง"
                    className="h-32 w-full object-cover object-center"
                  />
                </div>
              </div>

              <div className="mb-8">
                <p className="text-sm font-bold text-brand-600">ระบบรถรับส่งนักเรียนจังหวัดลำปาง</p>
                <h2 className="mt-3 text-4xl font-black leading-tight text-brand-900 sm:text-5xl">
                  เข้าสู่ระบบ
                </h2>
                <p className="mt-3 text-base leading-7 text-ink-muted">
                  สำหรับผู้มีสิทธิ์ใช้งานระบบ เพื่อตรวจสอบข้อมูลรถรับส่งและการเดินทางของนักเรียน
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="login-username" className="mb-2 block text-base font-bold text-ink">
                    ชื่อผู้ใช้หรือทะเบียนรถ
                  </label>
                  <input
                    id="login-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoFocus
                    autoComplete="username"
                    className={FIELD_CLASS}
                    placeholder="เช่น school001 หรือ กข-1234"
                  />
                  <p className="mt-2 text-sm leading-6 text-ink-muted">
                    คนขับสามารถใช้ทะเบียนรถที่ได้รับมอบหมาย
                  </p>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label htmlFor="login-password" className="block text-base font-bold text-ink">
                      รหัสผ่าน
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="inline-flex min-h-[44px] items-center rounded-full px-3 text-sm font-bold text-brand-700 transition hover:bg-brand-50 focus:outline-none focus:ring-4 focus:ring-brand-600/15"
                      aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                    >
                      {showPassword ? 'ซ่อน' : 'แสดง'}
                    </button>
                  </div>
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className={FIELD_CLASS}
                    placeholder="กรอกรหัสผ่าน"
                  />
                </div>

                {error && errStyle && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className={`rounded-2xl border px-4 py-3 text-sm motion-safe:animate-fade-in ${errStyle.wrap}`}
                  >
                    <p className="inline-flex items-center gap-1.5 font-semibold">
                      <errStyle.Icon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                      <span>{error.msg}</span>
                    </p>
                    {error.hint && (
                      <p className="mt-1 whitespace-pre-line text-xs opacity-80">{error.hint}</p>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 py-3 text-lg font-black text-white shadow-lg shadow-brand-600/25 transition-[background-color,transform] duration-150 hover:bg-brand-700 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/30"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
                </button>
              </form>

              <div className="mt-6 flex flex-col gap-3 border-t border-surface-border pt-5 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
                <span>ลืมรหัสผ่านหรือเข้าใช้งานไม่ได้</span>
                <button
                  type="button"
                  onClick={() => toast.info('กรุณาติดต่อผู้ดูแลระบบประจำโรงเรียนหรือต้นสังกัด')}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-brand-200 px-4 font-bold text-brand-700 transition hover:bg-brand-50 focus:outline-none focus:ring-4 focus:ring-brand-600/15"
                >
                  ติดต่อผู้ดูแลระบบ
                </button>
              </div>

              <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-ink-muted">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                ระบบกำกับความปลอดภัยรถรับส่งนักเรียน
              </p>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
