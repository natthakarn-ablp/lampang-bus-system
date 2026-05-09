import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bus, Clock, Lock, WifiOff, AlertTriangle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/Toast';
import { ROLE_HOME } from '../App';

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-blue-50 px-4">
      <div className="bg-white rounded-2xl shadow-lg p-6 sm:p-10 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-brand-700 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Bus className="w-8 h-8 text-white" strokeWidth={2} aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-blue-800">ระบบรถรับส่งนักเรียน</h1>
          <p className="text-gray-500 text-sm mt-1">จังหวัดลำปาง</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ชื่อผู้ใช้ / ทะเบียนรถ
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="กรอกชื่อผู้ใช้"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              รหัสผ่าน
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="กรอกรหัสผ่าน"
            />
          </div>

          {error && (
            <div className={`rounded-lg px-4 py-3 text-sm border ${
              error.type === 'rate' ? 'bg-amber-50 border-amber-200 text-amber-800'
              : error.type === 'disabled' ? 'bg-gray-50 border-gray-300 text-gray-700'
              : error.type === 'network' ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              <p className="font-medium inline-flex items-center gap-1.5">
                {(() => {
                  const ErrIcon = error.type === 'rate' ? Clock
                              : error.type === 'disabled' ? Lock
                              : error.type === 'network' ? WifiOff
                              : AlertTriangle;
                  return <ErrIcon className="w-4 h-4 shrink-0" strokeWidth={2} aria-hidden="true" />;
                })()}
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
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg py-3 transition"
          >
            {loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  );
}
