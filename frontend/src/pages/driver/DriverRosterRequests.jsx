import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import ApprovalBadge from '../../components/ApprovalBadge';
import { useToast } from '../../components/Toast';

const PREFIX_OPTIONS = ['เด็กชาย', 'เด็กหญิง', 'นาย', 'นางสาว', 'นาง'];

export default function DriverRosterRequests() {
  const [requests, setRequests] = useState([]);
  const [students, setStudents] = useState([]);
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [requestType, setRequestType] = useState('remove');
  const [removeStudentId, setRemoveStudentId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  // New student form fields
  const [newStudent, setNewStudent] = useState({
    student_id: '', prefix: 'เด็กชาย', first_name: '', last_name: '',
    school_id: '', grade: '', classroom: '',
    parent_name: '', parent_phone: '',
  });
  const [phoneError, setPhoneError] = useState('');

  const fetchRequests = useCallback(async () => {
    try {
      const res = await api.get('/driver/roster-requests');
      setRequests(res.data.data);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchRequests();
    api.get('/driver/roster').then(r => setStudents(r.data.data.students || [])).catch(() => {});
    api.get('/driver/schools').then(r => setSchools(r.data.data || [])).catch(() => {});
  }, [fetchRequests]);

  function validatePhone(val) {
    const digits = val.replace(/\D/g, '');
    if (digits.length > 0 && digits.length !== 10) {
      setPhoneError('เบอร์โทรต้องเป็นตัวเลข 10 หลัก');
    } else {
      setPhoneError('');
    }
    return digits;
  }

  function resetForm() {
    setRequestType('remove');
    setRemoveStudentId('');
    setReason('');
    setNewStudent({
      student_id: '', prefix: 'เด็กชาย', first_name: '', last_name: '',
      school_id: '', grade: '', classroom: '',
      parent_name: '', parent_phone: '',
    });
    setPhoneError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (requestType === 'remove') {
      if (!removeStudentId) { toast.error('กรุณาเลือกนักเรียนที่ต้องการถอน'); return; }
    } else {
      // add: validate new student
      if (!newStudent.first_name.trim() || !newStudent.last_name.trim()) {
        toast.error('กรุณากรอกชื่อและนามสกุลนักเรียน'); return;
      }
      if (!newStudent.school_id) {
        toast.error('กรุณาเลือกโรงเรียน'); return;
      }
      if (newStudent.parent_phone && !/^\d{10}$/.test(newStudent.parent_phone)) {
        toast.error('เบอร์โทรผู้ปกครองต้องเป็นตัวเลข 10 หลัก'); return;
      }
    }

    setSaving(true);
    try {
      const body = { request_type: requestType, reason: reason || undefined };
      if (requestType === 'remove') {
        body.student_id = removeStudentId;
      } else {
        body.new_student_data = {
          ...newStudent,
          student_id: newStudent.student_id || undefined,
        };
      }

      await api.post('/driver/roster-request', body);
      toast.success('ส่งคำขอสำเร็จ');
      setShowForm(false);
      resetForm();
      fetchRequests();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถส่งคำขอได้');
    } finally { setSaving(false); }
  }

  const TYPE_LABEL = { add: 'เพิ่มนักเรียน', remove: 'ถอนนักเรียน' };
  const pending = requests.filter(r => r.status === 'pending');
  const resolved = requests.filter(r => r.status !== 'pending');

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-800">คำขอเปลี่ยนแปลงรายชื่อ</h1>
          <p className="text-xs text-gray-400 mt-0.5">ขอเพิ่มหรือถอนนักเรียนจากรถ (โรงเรียนจะเป็นผู้อนุมัติ)</p>
        </div>
        <button onClick={() => { if (showForm) resetForm(); setShowForm(!showForm); }}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          {showForm ? 'ปิด' : 'สร้างคำขอ'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-5">
          <h2 className="text-sm font-semibold text-gray-700">สร้างคำขอใหม่</h2>

          {/* Type selector */}
          <div>
            <label className="block text-sm text-gray-600 mb-1.5">ประเภทคำขอ</label>
            <div className="flex gap-2">
              {[
                { val: 'remove', label: 'ถอนนักเรียนออกจากรถ', color: 'red' },
                { val: 'add', label: 'เพิ่มนักเรียนเข้ารถ', color: 'green' },
              ].map(opt => (
                <button key={opt.val} type="button"
                  onClick={() => setRequestType(opt.val)}
                  className={`flex-1 text-sm px-3 py-2 rounded-lg border transition ${requestType === opt.val
                    ? opt.color === 'red'
                      ? 'bg-red-50 border-red-300 text-red-700'
                      : 'bg-green-50 border-green-300 text-green-700'
                    : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Remove: pick from roster */}
          {requestType === 'remove' && (
            <div>
              <label className="block text-sm text-gray-600 mb-1.5">เลือกนักเรียนในรถ</label>
              <select value={removeStudentId} onChange={(e) => setRemoveStudentId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" required>
                <option value="">— เลือกนักเรียน —</option>
                {students.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.prefix}{s.first_name} {s.last_name} ({s.grade}/{s.classroom})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Add: new student form */}
          {requestType === 'add' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                กรอกข้อมูลนักเรียนที่ต้องการเพิ่มเข้ารถ โรงเรียนจะตรวจสอบและอนุมัติ
              </p>

              {/* Student ID (optional) */}
              <div>
                <label className="block text-sm text-gray-600 mb-1">รหัสนักเรียน <span className="text-gray-400">(ถ้ามี)</span></label>
                <input type="text" value={newStudent.student_id}
                  onChange={(e) => setNewStudent({ ...newStudent, student_id: e.target.value.replace(/\D/g, '') })}
                  placeholder="เช่น 22121"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>

              {/* Prefix + Name row */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">คำนำหน้า</label>
                  <select value={newStudent.prefix} onChange={(e) => setNewStudent({ ...newStudent, prefix: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                    {PREFIX_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">ชื่อ <span className="text-red-500">*</span></label>
                  <input type="text" value={newStudent.first_name} required
                    onChange={(e) => setNewStudent({ ...newStudent, first_name: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">นามสกุล <span className="text-red-500">*</span></label>
                  <input type="text" value={newStudent.last_name} required
                    onChange={(e) => setNewStudent({ ...newStudent, last_name: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>

              {/* School */}
              <div>
                <label className="block text-sm text-gray-600 mb-1">โรงเรียน <span className="text-red-500">*</span></label>
                <select value={newStudent.school_id} onChange={(e) => setNewStudent({ ...newStudent, school_id: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" required>
                  <option value="">— เลือกโรงเรียน —</option>
                  {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              {/* Grade + Classroom */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">ระดับชั้น</label>
                  <input type="text" value={newStudent.grade}
                    onChange={(e) => setNewStudent({ ...newStudent, grade: e.target.value })}
                    placeholder="เช่น ป.1, ม.3"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">ห้อง</label>
                  <input type="text" value={newStudent.classroom}
                    onChange={(e) => setNewStudent({ ...newStudent, classroom: e.target.value })}
                    placeholder="เช่น 1, 2/1"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>

              {/* Parent info */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-medium text-gray-500 mb-3">ข้อมูลผู้ปกครอง</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">ชื่อผู้ปกครอง</label>
                    <input type="text" value={newStudent.parent_name}
                      onChange={(e) => setNewStudent({ ...newStudent, parent_name: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">เบอร์โทรผู้ปกครอง</label>
                    <input type="tel" value={newStudent.parent_phone} maxLength={10}
                      onChange={(e) => {
                        const digits = validatePhone(e.target.value);
                        setNewStudent({ ...newStudent, parent_phone: digits });
                      }}
                      placeholder="0812345678"
                      className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${phoneError ? 'border-red-300' : 'border-gray-300'}`} />
                    {phoneError && <p className="text-xs text-red-500 mt-1">{phoneError}</p>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block text-sm text-gray-600 mb-1.5">เหตุผล <span className="text-gray-400">(ไม่บังคับ)</span></label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น ย้ายบ้าน, เปลี่ยนรถ, ผิดรถ ฯลฯ"
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>

          <button type="submit" disabled={saving || !!phoneError}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 rounded-lg transition w-full sm:w-auto">
            {saving ? 'กำลังส่ง…' : 'ส่งคำขอ'}
          </button>
        </form>
      )}

      {/* Request lists */}
      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : requests.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 text-base">ยังไม่มีคำขอ</p>
          <p className="text-xs text-gray-300 mt-1">กดปุ่ม "สร้างคำขอ" เพื่อเริ่มต้น</p>
        </div>
      ) : (
        <div className="space-y-5">
          {pending.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-amber-700 mb-2">รออนุมัติ ({pending.length})</h2>
              <div className="space-y-2">
                {pending.map(r => <RequestCard key={r.id} r={r} typeLabel={TYPE_LABEL} />)}
              </div>
            </div>
          )}
          {resolved.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 mb-2">ดำเนินการแล้ว ({resolved.length})</h2>
              <div className="space-y-2">
                {resolved.map(r => <RequestCard key={r.id} r={r} typeLabel={TYPE_LABEL} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RequestCard({ r, typeLabel }) {
  const isNew = !r.student_id && r.new_student_data;
  let displayName = r.student_name || '-';
  if (isNew) {
    try {
      const d = typeof r.new_student_data === 'string' ? JSON.parse(r.new_student_data) : r.new_student_data;
      displayName = `${d.prefix || ''}${d.first_name} ${d.last_name}`;
    } catch {}
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800">
            <span className={r.request_type === 'add' ? 'text-green-700' : 'text-red-700'}>
              {typeLabel[r.request_type]}
            </span>
            {' — '}{displayName}
            {isNew && <span className="text-xs text-amber-600 ml-1">(ใหม่)</span>}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            {r.grade && r.classroom ? `${r.grade}/${r.classroom}` : ''}
            {r.reason && <>{r.grade ? ' · ' : ''}{r.reason}</>}
            {!r.grade && !r.reason && '-'}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {new Date(r.created_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {r.review_note && <> · <span className="text-gray-500">หมายเหตุ: {r.review_note}</span></>}
          </p>
        </div>
        <ApprovalBadge status={r.status} />
      </div>
    </div>
  );
}
