import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { resolveLineUserId } from '../../utils/liff';

const STATUS_MAP = {
  CHECKED_IN:  { label: 'รับแล้ว',  cls: 'bg-green-100 text-green-700', icon: '✅' },
  CHECKED_OUT: { label: 'ส่งแล้ว',  cls: 'bg-blue-100 text-blue-700',  icon: '✅' },
  ABSENT:      { label: 'ไม่มา',   cls: 'bg-red-100 text-red-700',    icon: '❌' },
  CANCELLED:   { label: 'ยกเลิก',  cls: 'bg-gray-100 text-gray-500',  icon: '↩️' },
};

/**
 * Parent Status Page — standalone page for parents via LIFF or direct URL.
 *
 * Access: /parent?line_user_id=Uxxx  (LIFF will inject this)
 * No login required — identified by LINE user ID.
 * Data access is scoped to linked & approved children only (enforced by backend).
 */
export default function ParentStatus() {
  const [lineUserId, setLineUserId] = useState('');
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [view, setView] = useState('list'); // list | status | history
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Resolve line_user_id from LIFF SDK or URL query param, then fetch children
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await resolveLineUserId();
      if (cancelled) return;
      setLineUserId(id);
      if (!id) { setLoading(false); return; }
      setLoading(true);
      setError('');
      try {
        const res = await axios.get(`/api/parent/children?line_user_id=${encodeURIComponent(id)}`);
        if (!cancelled) setChildren(res.data.data || []);
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.message || 'ไม่สามารถโหลดข้อมูลได้');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function viewStatus(child) {
    setSelectedChild(child);
    setView('status');
    try {
      const res = await axios.get(`/api/parent/children/${child.id}/status?line_user_id=${encodeURIComponent(lineUserId)}`);
      setStatus(res.data.data);
    } catch {
      setStatus(null);
    }
  }

  async function viewHistory(child) {
    setSelectedChild(child);
    setView('history');
    try {
      const res = await axios.get(`/api/parent/children/${child.id}/history?line_user_id=${encodeURIComponent(lineUserId)}&days=7`);
      setHistory(res.data.data?.history || []);
    } catch {
      setHistory([]);
    }
  }

  // No line_user_id — show unlinked state
  if (!lineUserId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-sm text-center">
          <p className="text-4xl mb-4">🔗</p>
          <h1 className="text-lg font-bold text-gray-800 mb-2">ยังไม่ได้ผูกบัญชี</h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            กรุณาเพิ่มเพื่อน LINE OA ของระบบรถรับส่งนักเรียน แล้วพิมพ์ "ผูกบัญชี" เพื่อเชื่อมข้อมูลบุตรหลาน
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-6 max-w-sm text-center">
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  // No linked children
  if (children.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-sm text-center">
          <p className="text-4xl mb-4">👨‍👩‍👧‍👦</p>
          <h1 className="text-lg font-bold text-gray-800 mb-2">ไม่พบข้อมูลบุตรหลาน</h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            บัญชี LINE ของคุณยังไม่ได้ผูกกับนักเรียนในระบบ
            หรืออยู่ระหว่างรอโรงเรียนอนุมัติ
          </p>
          <p className="text-xs text-gray-400 mt-3">
            พิมพ์ "ผูกบัญชี" ใน LINE OA เพื่อเริ่มขั้นตอน
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-green-600 text-white px-4 py-4 shadow-sm">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-bold text-base">ระบบรถรับส่งนักเรียน</h1>
            <p className="text-green-100 text-xs">สำหรับผู้ปกครอง</p>
          </div>
          {view !== 'list' && (
            <button onClick={() => setView('list')}
              className="text-sm bg-green-500 hover:bg-green-400 px-3 py-1.5 rounded-lg transition">
              ← กลับ
            </button>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4">
        {/* Children list */}
        {view === 'list' && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-500">บุตรหลานของคุณ ({children.length} คน)</p>
            {children.map(child => (
              <div key={child.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-gray-800">{child.prefix}{child.first_name} {child.last_name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {child.grade && child.classroom ? `${child.grade}/${child.classroom}` : child.grade || '-'}
                      {child.school_name && ` · ${child.school_name}`}
                    </p>
                    {child.plate_no && (
                      <p className="text-xs text-gray-400 mt-0.5">🚐 {child.plate_no}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => viewStatus(child)}
                    className="flex-1 text-sm bg-green-50 text-green-700 font-medium py-2 rounded-lg hover:bg-green-100 transition border border-green-200">
                    สถานะวันนี้
                  </button>
                  <button onClick={() => viewHistory(child)}
                    className="flex-1 text-sm bg-blue-50 text-blue-700 font-medium py-2 rounded-lg hover:bg-blue-100 transition border border-blue-200">
                    ย้อนหลัง 7 วัน
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Today's status */}
        {view === 'status' && selectedChild && (
          <div className="space-y-3">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="font-semibold text-gray-800 mb-1">
                {selectedChild.prefix}{selectedChild.first_name} {selectedChild.last_name}
              </p>
              <p className="text-xs text-gray-500">{selectedChild.school_name || '-'}</p>
            </div>

            <p className="text-sm font-medium text-gray-500">สถานะวันนี้</p>

            <div className="grid grid-cols-2 gap-3">
              <div className={`rounded-xl border p-4 text-center ${status?.morning_done ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                <p className="text-2xl mb-1">{status?.morning_done ? '✅' : '⏳'}</p>
                <p className="text-sm font-medium text-gray-700">ส่งเช้า</p>
                <p className="text-xs text-gray-500 mt-1">
                  {status?.morning_done
                    ? (status.morning_ts ? new Date(status.morning_ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : 'ส่งแล้ว')
                    : 'ยังไม่ส่ง'}
                </p>
              </div>
              <div className={`rounded-xl border p-4 text-center ${status?.evening_done ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                <p className="text-2xl mb-1">{status?.evening_done ? '✅' : '⏳'}</p>
                <p className="text-sm font-medium text-gray-700">รับเย็น</p>
                <p className="text-xs text-gray-500 mt-1">
                  {status?.evening_done
                    ? (status.evening_ts ? new Date(status.evening_ts).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : 'รับแล้ว')
                    : 'ยังไม่รับ'}
                </p>
              </div>
            </div>

            {!status?.morning_done && !status?.evening_done && (
              <p className="text-xs text-gray-400 text-center">ยังไม่มีข้อมูลเช็คอินวันนี้</p>
            )}
          </div>
        )}

        {/* History */}
        {view === 'history' && selectedChild && (
          <div className="space-y-3">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="font-semibold text-gray-800 mb-1">
                {selectedChild.prefix}{selectedChild.first_name} {selectedChild.last_name}
              </p>
              <p className="text-xs text-gray-500">{selectedChild.school_name || '-'}</p>
            </div>

            <p className="text-sm font-medium text-gray-500">ประวัติ 7 วันล่าสุด</p>

            {history.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">ไม่มีประวัติในช่วงนี้</p>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs">
                      <th className="px-3 py-2 text-left font-medium">วันที่</th>
                      <th className="px-3 py-2 text-center font-medium">รอบ</th>
                      <th className="px-3 py-2 text-center font-medium">สถานะ</th>
                      <th className="px-3 py-2 text-right font-medium">เวลา</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {history.map((h, i) => {
                      const st = STATUS_MAP[h.status] || { label: h.status, cls: 'bg-gray-100 text-gray-500' };
                      return (
                        <tr key={i} className="hover:bg-gray-50/50">
                          <td className="px-3 py-2 text-gray-700 text-xs">
                            {new Date(h.check_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                          </td>
                          <td className="px-3 py-2 text-center text-xs text-gray-600">
                            {h.session === 'morning' ? 'เช้า' : 'เย็น'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-gray-500">
                            {h.checked_at ? new Date(h.checked_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
