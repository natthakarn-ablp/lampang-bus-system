import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/Toast';

const ROLE_HOME = {
  driver:      '/driver',
  school:      '/school',
  affiliation: '/affiliation',
  province:    '/province',
  transport:   '/transport',
  admin:       '/province',
};

const BRAND_LOGO = '/brand/school-safe-logo.jpg';
const BRAND_BANNER = '/brand/school-safe-banner.png';

export default function Login() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const toast     = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
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
      const msg = err.response?.data?.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen overflow-hidden bg-slate-50 text-slate-900">
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
        <div className="grid w-full max-w-6xl overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-2xl shadow-blue-950/10 lg:grid-cols-[1.08fr_0.92fr]">
          <section className="relative hidden min-h-[640px] bg-[#123B6D] p-10 text-white lg:block">
            <div className="absolute inset-0" aria-hidden="true">
              <div className="absolute left-[-10%] top-[-14%] h-96 w-96 rounded-full bg-cyan-300/20 blur-3xl" />
              <div className="absolute bottom-[-18%] right-[-10%] h-[28rem] w-[28rem] rounded-full bg-blue-400/20 blur-3xl" />
              <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-blue-950/45 to-transparent" />
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

                <div className="mt-10 overflow-hidden rounded-[24px] border border-white/30 bg-white shadow-2xl shadow-blue-950/30">
                  <img
                    src={BRAND_BANNER}
                    alt="ระบบรถรับส่งนักเรียนจังหวัดลำปาง เดินทางปลอดภัย อุ่นใจทุกเส้นทาง"
                    className="aspect-[16/7] w-full object-cover"
                  />
                </div>

                <div className="mt-8 max-w-xl">
                  <p className="text-base font-semibold tracking-normal text-cyan-100">อุ่นใจไปโรงเรียน</p>
                  <h1 className="mt-3 text-4xl font-black leading-tight tracking-normal">
                    ทุกการเดินทางของนักเรียน
                    <span className="mt-2 block text-3xl text-cyan-100">ต้องปลอดภัย ตรวจสอบได้ และอุ่นใจทุกคน</span>
                  </h1>
                  <p className="mt-5 max-w-lg text-lg leading-8 text-blue-50">
                    ใช้ติดตามข้อมูลรถรับส่ง นักเรียน คนขับ ผู้ปกครอง โรงเรียน ต้นสังกัด และรายงานการเดินทางในจังหวัดลำปาง
                  </p>
                </div>
              </div>

              <div className="relative mt-8 rounded-2xl border border-white/18 bg-white/10 p-5 backdrop-blur">
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

          <main className="relative bg-white px-5 py-8 sm:px-10 lg:px-12 lg:py-14">
            <div className="mx-auto flex w-full max-w-md flex-col">
              <div className="mb-8 lg:hidden">
                <div className="inline-flex items-center gap-3 rounded-full bg-blue-50 px-3 py-2 text-sm font-semibold text-[#123B6D]">
                  <img
                    src={BRAND_LOGO}
                    alt=""
                    className="h-9 w-9 rounded-full border border-blue-100 bg-white object-cover"
                  />
                  รถรับส่งนักเรียนลำปาง
                </div>
                <div className="mt-5 overflow-hidden rounded-3xl border border-blue-100 bg-blue-50 shadow-lg shadow-blue-950/10">
                  <img
                    src={BRAND_BANNER}
                    alt="ระบบรถรับส่งนักเรียนจังหวัดลำปาง"
                    className="h-32 w-full object-cover object-center"
                  />
                </div>
              </div>

              <div className="mb-8">
                <p className="text-sm font-bold tracking-normal text-blue-600">ระบบรถรับส่งนักเรียนจังหวัดลำปาง</p>
                <h2 className="mt-3 text-4xl font-black leading-tight text-[#123B6D] sm:text-5xl">
                  เข้าสู่ระบบ
                </h2>
                <p className="mt-3 text-base leading-7 text-slate-600">
                  สำหรับผู้มีสิทธิ์ใช้งานระบบ เพื่อตรวจสอบข้อมูลรถรับส่งและการเดินทางของนักเรียน
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-base font-bold text-slate-800 mb-2" htmlFor="login-username">
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
                    className="min-h-[48px] w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-lg font-semibold text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    placeholder="เช่น school001 หรือ กข-1234"
                  />
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    คนขับสามารถใช้ทะเบียนรถที่ได้รับมอบหมาย
                  </p>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label className="block text-base font-bold text-slate-800" htmlFor="login-password">
                      รหัสผ่าน
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="inline-flex min-h-[44px] items-center rounded-full px-3 text-sm font-bold text-blue-700 transition hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-blue-100"
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
                    className="min-h-[48px] w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-lg font-semibold text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    placeholder="กรอกรหัสผ่าน"
                  />
                </div>

                {error && (
                  <p
                    className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-base font-semibold leading-7 text-red-700"
                    role="alert"
                    aria-live="polite"
                  >
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="min-h-[52px] w-full rounded-2xl bg-[#2563EB] px-5 py-3 text-lg font-black text-white shadow-lg shadow-blue-600/25 transition hover:bg-[#1D4ED8] focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
                </button>
              </form>

              <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-5 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <span>ลืมรหัสผ่านหรือเข้าใช้งานไม่ได้</span>
                <button
                  type="button"
                  onClick={() => toast.info('กรุณาติดต่อผู้ดูแลระบบประจำโรงเรียนหรือต้นสังกัด')}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-blue-200 px-4 font-bold text-blue-700 transition hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-blue-100"
                >
                  ติดต่อผู้ดูแลระบบ
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
