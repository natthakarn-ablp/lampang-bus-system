import { useEffect, useState } from 'react';
import { Copy, Download, KeyRound, Link2, RefreshCw, ShieldCheck, Unlink } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import { AlertBanner, AppCard, FormField } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import { getLiffIdToken, resolveLineUserId } from '../../utils/liff';

function formatThaiDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
  }).format(new Date(value));
}

export default function AdminAccountSecurity() {
  const { features } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [codes, setCodes] = useState([]);
  const [lineIdToken, setLineIdToken] = useState('');

  async function loadStatus() {
    setLoading(true);
    try {
      const response = await api.get('/auth/recovery/admin/status');
      setStatus(response.data.data);
    } catch (err) {
      setError(err.response?.data?.message || 'ไม่สามารถอ่านสถานะการกู้คืนบัญชีได้');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!features?.adminPasswordRecovery) {
      setLoading(false);
      return;
    }
    loadStatus();
    getLiffIdToken().then(setLineIdToken).catch(() => setLineIdToken(''));
  }, [features?.adminPasswordRecovery]);

  async function prepareLine() {
    setError('');
    setBusy('line-login');
    try {
      await resolveLineUserId();
      const token = await getLiffIdToken();
      if (!token) {
        setError('ไม่พบข้อมูลยืนยันจาก LINE กรุณาเปิดหน้านี้ผ่าน LIFF แล้วลองใหม่');
        return;
      }
      setLineIdToken(token);
      toast.success('ยืนยันตัวตนกับ LINE แล้ว');
    } catch (err) {
      setError(err?.message || 'ไม่สามารถเริ่มการยืนยันกับ LINE ได้');
    } finally {
      setBusy('');
    }
  }

  async function linkLine() {
    setError('');
    if (!password) return setError('กรุณากรอกรหัสผ่านปัจจุบัน');
    setBusy('link');
    try {
      if (!lineIdToken) {
        setError('กรุณากดยืนยันตัวตนกับ LINE ก่อน');
        return;
      }
      const response = await api.post('/auth/recovery/admin/link-line', {
        current_password: password,
        id_token: lineIdToken,
      });
      setCodes(response.data.data?.recovery_codes || []);
      setPassword('');
      toast.success('ผูก LINE สำหรับกู้คืนรหัสผ่านสำเร็จ');
      await loadStatus();
    } catch (err) {
      setError(err.response?.data?.message || 'ไม่สามารถผูกบัญชี LINE ได้');
    } finally {
      setBusy('');
    }
  }

  async function regenerateCodes() {
    setError('');
    if (!password) return setError('กรุณากรอกรหัสผ่านปัจจุบัน');
    setBusy('codes');
    try {
      const response = await api.post('/auth/recovery/admin/regenerate-codes', {
        current_password: password,
      });
      setCodes(response.data.data?.recovery_codes || []);
      setPassword('');
      toast.success('สร้างรหัสกู้คืนชุดใหม่แล้ว');
      await loadStatus();
    } catch (err) {
      setError(err.response?.data?.message || 'ไม่สามารถสร้างรหัสกู้คืนได้');
    } finally {
      setBusy('');
    }
  }

  async function unlinkLine() {
    setError('');
    if (!password) return setError('กรุณากรอกรหัสผ่านปัจจุบัน');
    if (!window.confirm('ยกเลิกการผูก LINE และรหัสกู้คืนทั้งหมดใช่หรือไม่')) return;
    setBusy('unlink');
    try {
      await api.delete('/auth/recovery/admin/line', { data: { current_password: password } });
      setCodes([]);
      setPassword('');
      toast.success('ยกเลิกการผูก LINE แล้ว');
      await loadStatus();
    } catch (err) {
      setError(err.response?.data?.message || 'ไม่สามารถยกเลิกการผูก LINE ได้');
    } finally {
      setBusy('');
    }
  }

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success('คัดลอกรหัสกู้คืนแล้ว');
    } catch {
      toast.error('คัดลอกอัตโนมัติไม่ได้ กรุณาใช้ปุ่มดาวน์โหลด');
    }
  }

  function downloadCodes() {
    const content = [
      'School Safe Connect - รหัสกู้คืนบัญชีผู้ดูแลระบบ',
      'เก็บเป็นความลับ แต่ละรหัสใช้ได้ครั้งเดียว',
      '',
      ...codes,
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'school-safe-connect-admin-recovery-codes.txt';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <PageHeader
        icon={ShieldCheck}
        title="ความปลอดภัยบัญชี"
        subtitle="ตั้งค่าการกู้คืนรหัสผ่านของผู้ดูแลระบบผ่าน LINE"
        breadcrumb={[{ label: 'ผู้ดูแลระบบ', to: '/admin' }, { label: 'ความปลอดภัยบัญชี' }]}
      />

      {!features?.adminPasswordRecovery ? (
        <AlertBanner variant="warn" title="ยังไม่เปิดใช้การกู้คืนรหัสผ่าน">
          ผู้ดูแลระบบต้องติดตั้ง migration 049 และเปิด feature flag หลังผ่านการทดสอบ LINE OA จริง
        </AlertBanner>
      ) : (
        <div className="space-y-5">
          <AppCard className="grid gap-5 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${status?.line_linked ? 'bg-success' : 'bg-warn'}`} />
                <h2 className="text-lg font-bold text-ink">
                  {loading ? 'กำลังตรวจสอบ…' : status?.line_linked ? 'ผูก LINE แล้ว' : 'ยังไม่ได้ผูก LINE'}
                </h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-ink-muted">
                {status?.line_linked
                  ? `ยืนยันล่าสุด ${formatThaiDate(status.verified_at)} · เหลือรหัสกู้คืน ${status.recovery_codes_remaining} รหัส`
                  : 'LINE ที่ผูกต้องเพิ่มเพื่อน LINE OA และรับข้อความทดสอบได้'}
              </p>
            </div>
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-success-soft text-success-ink">
              <Link2 className="h-6 w-6" aria-hidden="true" />
            </div>
          </AppCard>

          {codes.length > 0 && (
            <AppCard className="border-warn/50 bg-warn-soft">
              <AlertBanner variant="warn" title="บันทึกรหัสชุดนี้ทันที">
                ระบบจะแสดงรหัสเพียงครั้งเดียว แต่ละรหัสใช้ได้ครั้งเดียวและต้องใช้ร่วมกับลิงก์จาก LINE
              </AlertBanner>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="รหัสกู้คืน">
                {codes.map((code) => (
                  <code key={code} className="rounded-lg border border-warn/40 bg-white px-3 py-2 text-center text-sm font-bold text-ink">
                    {code}
                  </code>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={copyCodes} className="focus-ring inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white hover:bg-brand-700">
                  <Copy className="h-4 w-4" aria-hidden="true" /> คัดลอก
                </button>
                <button type="button" onClick={downloadCodes} className="focus-ring inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-surface-border bg-white px-4 font-bold text-ink hover:bg-surface">
                  <Download className="h-4 w-4" aria-hidden="true" /> ดาวน์โหลด
                </button>
              </div>
            </AppCard>
          )}

          <AppCard>
            <h2 className="text-lg font-bold text-ink">ยืนยันการเปลี่ยนแปลง</h2>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              กรอกรหัสผ่านปัจจุบันทุกครั้งก่อนผูก LINE สร้างรหัสชุดใหม่ หรือยกเลิกการผูก
            </p>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-surface-border bg-surface p-3">
              <div>
                <p className="text-sm font-bold text-ink">การยืนยัน LINE</p>
                <p className="mt-0.5 text-xs text-ink-muted">{lineIdToken ? 'พร้อมผูกบัญชี' : 'ยังไม่ได้ยืนยันในรอบนี้'}</p>
              </div>
              <button type="button" onClick={prepareLine} disabled={Boolean(busy)} className="focus-ring inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-lg border border-brand-200 bg-white px-3 font-bold text-brand-700 hover:bg-brand-50 disabled:opacity-50">
                <Link2 className="h-4 w-4" aria-hidden="true" />
                {busy === 'line-login' ? 'กำลังเปิด LINE…' : lineIdToken ? 'ยืนยันใหม่' : 'ยืนยัน LINE'}
              </button>
            </div>
            <FormField
              className="mt-4 max-w-md"
              label="รหัสผ่านปัจจุบัน"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              required
            />
            {error && <AlertBanner variant="danger" className="mt-4">{error}</AlertBanner>}
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={linkLine} disabled={Boolean(busy) || !lineIdToken} className="focus-ring inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-brand-600 px-4 font-bold text-white hover:bg-brand-700 disabled:opacity-50">
                <Link2 className="h-4 w-4" aria-hidden="true" />
                {busy === 'link' ? 'กำลังยืนยัน…' : status?.line_linked ? 'ยืนยันหรือเปลี่ยน LINE' : 'ผูกบัญชี LINE'}
              </button>
              {status?.line_linked && (
                <>
                  <button type="button" onClick={regenerateCodes} disabled={Boolean(busy)} className="focus-ring inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-surface-border bg-white px-4 font-bold text-ink hover:bg-surface disabled:opacity-50">
                    <RefreshCw className="h-4 w-4" aria-hidden="true" /> สร้างรหัสชุดใหม่
                  </button>
                  <button type="button" onClick={unlinkLine} disabled={Boolean(busy)} className="focus-ring inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 font-bold text-danger-ink hover:bg-danger-soft disabled:opacity-50">
                    <Unlink className="h-4 w-4" aria-hidden="true" /> ยกเลิกการผูก
                  </button>
                </>
              )}
            </div>
          </AppCard>

          <AlertBanner variant="info" icon={KeyRound} title="เมื่อจำรหัสผ่านไม่ได้">
            กรอกชื่อผู้ใช้ที่หน้า “ลืมรหัสผ่าน” ระบบจะส่งลิงก์อายุ 15 นาทีไปยัง LINE จากนั้นกรอกรหัสกู้คืนหนึ่งรหัสและตั้งรหัสผ่านใหม่
          </AlertBanner>
        </div>
      )}
    </div>
  );
}
