import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';

export default function EmergencyPage() {
  const navigate = useNavigate();

  const [detail,  setDetail]  = useState('');
  const [note,    setNote]    = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error,   setError]   = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.post('/driver/emergency', { detail, note });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.message || 'เกิดข้อผิดพลาด');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="p-6 max-w-lg mx-auto flex flex-col items-center justify-center min-h-[60vh]">
        <div className="text-6xl mb-5">✅</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">แจ้งเหตุฉุกเฉินแล้ว</h2>
        <p className="text-gray-500 text-sm mb-8">ทีมงานจะดำเนินการโดยเร็ว</p>
        <button
          onClick={() => navigate('/driver', { replace: true })}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-8 py-2.5 rounded-lg transition"
        >
          กลับหน้าหลัก
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-red-700">🚨 แจ้งเหตุฉุกเฉิน</h1>
        <p className="text-sm text-gray-500 mt-1">กรอกรายละเอียดเหตุการณ์ที่เกิดขึ้น</p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            รายละเอียด <span className="text-red-500">*</span>
          </label>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            required
            rows={4}
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            placeholder="อธิบายเหตุการณ์ที่เกิดขึ้น เช่น รถเสีย, อุบัติเหตุ, นักเรียนเจ็บป่วย"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
            placeholder="ข้อมูลเพิ่มเติม (ถ้ามี)"
          />
        </div>

        {error && (
          <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition"
          >
            {loading ? 'กำลังส่ง…' : 'แจ้งเหตุฉุกเฉิน'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-lg transition"
          >
            ยกเลิก
          </button>
        </div>
      </form>
    </div>
  );
}
