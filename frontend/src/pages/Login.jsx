import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bus, Clock, Lock, WifiOff, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
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
  'w-full min-h-[44px] rounded-lg border border-surface-border bg-surface-raised px-4 py-2.5 ' +
  'text-ink placeholder:text-ink-muted/70 transition-colors duration-150 ' +
  'focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/15';

export default function Login() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const toast     = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState(null); // { msg, hint?, type? }
  const [loading,  setLoading]  = useState(false);

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
    <div className="min-h-screen flex items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-md motion-safe:animate-scale-in">
        <div className="bg-surface-raised border border-surface-border rounded-2xl shadow-elevate p-6 sm:p-9">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-brand-800 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-soft motion-safe:animate-fade-in-up">
              <Bus className="w-8 h-8 text-white" strokeWidth={2} aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-brand-900">ระบบรถรับส่งนักเรียน</h1>
            <p className="text-ink-muted text-sm mt-1">จังหวัดลำปาง</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="login-username" className="block text-sm font-semibold text-ink mb-1.5">
                ชื่อผู้ใช้ / ทะเบียนรถ
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
                placeholder="กรอกชื่อผู้ใช้"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-semibold text-ink mb-1.5">
                รหัสผ่าน
              </label>
              <input
                id="login-password"
                type="password"
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
                className={`rounded-lg border px-4 py-3 text-sm motion-safe:animate-fade-in ${errStyle.wrap}`}
              >
                <p className="font-semibold inline-flex items-center gap-1.5">
                  <errStyle.Icon className="w-4 h-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                  <span>{error.msg}</span>
                </p>
                {error.hint && (
                  <p className="mt-1 text-xs opacity-80 whitespace-pre-line">{error.hint}</p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-3 font-semibold text-white shadow-soft transition-[background-color,transform] duration-150 hover:bg-brand-700 active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/30"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
              {loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
            </button>
          </form>
        </div>

        {/* Trust line */}
        <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-ink-muted">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
          ระบบกำกับความปลอดภัยรถรับส่งนักเรียน
        </p>
      </div>
    </div>
  );
}
