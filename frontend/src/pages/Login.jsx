import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronDown,
  CircleHelp,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
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
  'w-full min-h-[48px] rounded-lg border border-surface-border bg-surface-raised px-4 py-3 ' +
  'text-lg font-semibold text-ink placeholder:text-ink-muted/70 shadow-sm transition-colors duration-150 ' +
  'focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/15';

const BRAND_LOGO = '/brand/school-safe-logo.webp';
const BRAND_BANNER = '/brand/school-safe-banner.webp';
const BRAND_BANNER_MOBILE = '/brand/school-safe-banner-640.webp';

export default function Login() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const toast     = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState(null); // { msg, hint?, type? }
  const [loading,  setLoading]  = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

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
    <div className="min-h-screen bg-slate-50 text-ink">
      <div className="flex min-h-screen items-center justify-center px-3 py-3 sm:px-6 sm:py-6 lg:px-10 lg:py-6">
        <div className="grid w-full max-w-6xl overflow-hidden rounded-lg border border-surface-border bg-white shadow-elevate motion-safe:animate-scale-in lg:grid-cols-[1.08fr_0.92fr]">
          <section className="hidden min-h-[580px] bg-brand-900 p-8 text-white lg:block xl:min-h-[600px]">
            <div className="flex h-full flex-col justify-between">
              <div>
                <div className="inline-flex items-center gap-3 text-sm font-semibold text-blue-50">
                  <img
                    src={BRAND_LOGO}
                    alt=""
                    className="h-10 w-10 rounded-full border border-white/60 bg-white object-cover"
                  />
                  ระบบรถรับส่งนักเรียนจังหวัดลำปาง
                </div>

                <div className="mt-6 overflow-hidden rounded-lg border border-white/30 bg-white shadow-elevate">
                  <img
                    src={BRAND_BANNER}
                    alt="ระบบรถรับส่งนักเรียนจังหวัดลำปาง เดินทางปลอดภัย อุ่นใจทุกเส้นทาง"
                    className="aspect-[16/6] w-full object-cover"
                  />
                </div>

                <div className="mt-5 max-w-xl">
                  <p className="text-sm font-semibold text-cyan-100">อุ่นใจไปโรงเรียน</p>
                  <h1 className="mt-2 text-3xl font-black leading-tight tracking-normal">
                    ทุกการเดินทางของนักเรียน
                    <span className="mt-1 block text-2xl text-cyan-100">ต้องปลอดภัย ตรวจสอบได้ และอุ่นใจทุกคน</span>
                  </h1>
                  <p className="mt-3 max-w-lg text-sm leading-6 text-blue-50">
                    ใช้ติดตามข้อมูลรถรับส่ง นักเรียน คนขับ ผู้ปกครอง โรงเรียน ต้นสังกัด และรายงานการเดินทางในจังหวัดลำปาง
                  </p>
                </div>
              </div>

              <div className="mt-5 border-t border-white/20 pt-4">
                <div className="grid grid-cols-3 gap-5">
                  {[
                    ['6', 'สิทธิ์ผู้ใช้งาน'],
                    ['ตรวจสอบ', 'ข้อมูลย้อนหลัง'],
                    ['แจ้งเตือน', 'ถึงผู้ปกครอง'],
                  ].map(([value, label]) => (
                    <div key={label}>
                      <p className="text-xl font-black text-white">{value}</p>
                      <p className="mt-1 text-xs text-blue-100">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <main className="bg-surface-raised px-4 py-5 sm:px-10 sm:py-8 lg:px-12">
            <div className="mx-auto flex w-full max-w-md flex-col">
              <div className="mb-5 lg:hidden">
                <div className="inline-flex items-center gap-3 text-sm font-semibold text-brand-900">
                  <img
                    src={BRAND_LOGO}
                    alt=""
                    className="h-9 w-9 rounded-full border border-brand-100 bg-white object-cover"
                  />
                  รถรับส่งนักเรียนลำปาง
                </div>
                <div className="mt-3 overflow-hidden rounded-lg border border-brand-100 bg-brand-50">
                  <picture>
                    <source media="(max-width: 767px)" srcSet={BRAND_BANNER_MOBILE} />
                    <img
                      src={BRAND_BANNER}
                      alt="ระบบรถรับส่งนักเรียนจังหวัดลำปาง"
                      className="h-24 w-full object-cover object-center sm:h-28"
                    />
                  </picture>
                </div>
              </div>

              <div className="mb-5">
                <p className="hidden text-sm font-bold text-brand-600 lg:block">ระบบรถรับส่งนักเรียนจังหวัดลำปาง</p>
                <h2 className="text-3xl font-black leading-tight text-brand-900 sm:text-4xl lg:mt-2">
                  เข้าสู่ระบบ
                </h2>
                <p className="mt-2 text-sm leading-6 text-ink-muted sm:text-base">
                  สำหรับผู้มีสิทธิ์ใช้งานระบบ เพื่อตรวจสอบข้อมูลรถรับส่งและการเดินทางของนักเรียน
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
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
                  <p className="mt-1.5 text-sm leading-5 text-ink-muted">
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
                      className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-lg text-brand-700 transition hover:bg-brand-50"
                      aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                      title={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
                    >
                      {showPassword
                        ? <EyeOff className="h-5 w-5" aria-hidden="true" />
                        : <Eye className="h-5 w-5" aria-hidden="true" />}
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
                    className={`rounded-lg border px-4 py-3 text-sm motion-safe:animate-fade-in ${errStyle.wrap}`}
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
                  className="focus-ring inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-lg font-black text-white shadow-soft transition-[background-color,transform] duration-150 hover:bg-brand-700 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
                </button>
              </form>

              <div className="mt-4 border-t border-surface-border pt-3 text-sm text-ink-muted">
                <button
                  type="button"
                  onClick={() => setShowHelp((value) => !value)}
                  className="focus-ring flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg px-2 font-bold text-brand-700 transition hover:bg-brand-50"
                  aria-expanded={showHelp}
                  aria-controls="login-support-help"
                >
                  <span className="inline-flex items-center gap-2">
                    <CircleHelp className="h-5 w-5" aria-hidden="true" />
                    ลืมรหัสผ่านหรือเข้าใช้งานไม่ได้
                  </span>
                  <ChevronDown
                    className={`h-5 w-5 transition-transform ${showHelp ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </button>
                {showHelp && (
                  <div id="login-support-help" className="mt-2 rounded-lg border border-brand-100 bg-brand-50 p-3 leading-6 text-ink motion-safe:animate-fade-in">
                    <p className="font-bold">ช่องทางขอความช่วยเหลือ</p>
                    <p className="mt-1">โรงเรียนและคนขับ: ติดต่อผู้ดูแลบัญชีของโรงเรียน</p>
                    <p>ต้นสังกัด ขนส่ง และจังหวัด: ติดต่อผู้ดูแลระบบระดับจังหวัด</p>
                  </div>
                )}
              </div>

              <footer className="mt-3 border-t border-surface-border pt-3 text-center text-xs leading-5 text-ink-muted">
                <p className="flex items-center justify-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                  ริเริ่ม ออกแบบ และพัฒนาระบบโดย
                </p>
                <p className="font-bold text-ink">นางสาวณัฐกานต์ เสถียรกาล</p>
                <p>ครูโรงเรียนอนุบาลลำปางเขลางค์รัตน์อนุสรณ์</p>
              </footer>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
