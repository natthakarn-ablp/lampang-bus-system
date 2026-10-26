import { useState, useEffect, useCallback } from 'react';
import { ClipboardList } from 'lucide-react';
import api from '../../api/axios';
import { FormField } from '../../components/ui';
import PageHeader from '../../components/PageHeader';
import ApprovalBadge from '../../components/ApprovalBadge';
import { useToast } from '../../components/Toast';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import { formatGradeClass } from '../../utils/student';

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
      const list = res?.data?.data;
      setRequests(Array.isArray(list) ? list : []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchRequests();
    api.get('/driver/roster').then(r => setStudents(r?.data?.data?.students || [])).catch(() => {});
    api.get('/driver/schools').then(r => {
      const s = r?.data?.data;
      setSchools(Array.isArray(s) ? s : []);
    }).catch(() => {});
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
          <PageHeader
            title="คำขอเปลี่ยนแปลงรายชื่อ"
            subtitle="ขอเพิ่มหรือถอนนักเรียนจากรถ (โรงเรียนจะเป็นผู้อนุมัติ)"
          />
        </div>
        <button onClick={() => { if (showForm) resetForm(); setShowForm(!showForm); }}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          {showForm ? 'ปิด' : 'สร้างคำขอ'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-5">
          <h2 className="text-sm font-semibold text-ink">สร้างคำขอใหม่</h2>

          {/* Type selector */}
          <div>
            <p id="request-type-label" className="block text-sm font-medium text-ink mb-1.5">ประเภทคำขอ</p>
            <div role="radiogroup" aria-labelledby="request-type-label" className="flex gap-2">
              {[
                { val: 'remove', label: 'ถอนนักเรียนออกจากรถ', tone: 'danger' },
                { val: 'add', label: 'เพิ่มนักเรียนเข้ารถ', tone: 'success' },
              ].map(opt => {
                const on = requestType === opt.val;
                return (
                  <button key={opt.val} type="button" role="radio" aria-checked={on}
                    onClick={() => setRequestType(opt.val)}
                    className={`focus-ring flex-1 text-sm px-3 min-h-[44px] rounded-lg border font-medium transition ${
                      on
                        ? (opt.tone === 'danger'
                            ? 'bg-danger-soft border-danger/40 text-danger-ink'
                            : 'bg-success-soft border-success/40 text-success-ink')
                        : 'bg-surface border-surface-border text-ink-muted hover:bg-surface-border hover:text-ink'
                    }`}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Remove: pick from roster */}
          {requestType === 'remove' && (
            <FormField label="เลือกนักเรียนในรถ" required>
              {ctl => (
                <select {...ctl} value={removeStudentId} onChange={(e) => setRemoveStudentId(e.target.value)}
                  className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition" required>
                  <option value="">— เลือกนักเรียน —</option>
                  {students.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.prefix}{s.first_name} {s.last_name} ({formatGradeClass(s.grade, s.classroom)})
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          )}

          {/* Add: new student form */}
          {requestType === 'add' && (
            <div className="space-y-4">
              <p className="text-caption text-ink-muted bg-surface rounded-lg px-3 py-2">
                กรอกข้อมูลนักเรียนที่ต้องการเพิ่มเข้ารถ โรงเรียนจะตรวจสอบและอนุมัติ
              </p>

              {/* Student ID (optional) */}
              <FormField
                label="รหัสนักเรียน"
                helper="ไม่บังคับ"
                inputMode="numeric"
                value={newStudent.student_id}
                onChange={v => setNewStudent({ ...newStudent, student_id: v.replace(/\D/g, '') })}
                placeholder="เช่น 22121"
              />

              {/* Prefix + Name row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <FormField label="คำนำหน้า">
                  {ctl => (
                    <select {...ctl} value={newStudent.prefix} onChange={(e) => setNewStudent({ ...newStudent, prefix: e.target.value })}
                      className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition">
                      {PREFIX_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  )}
                </FormField>
                <FormField label="ชื่อ" required value={newStudent.first_name}
                  onChange={v => setNewStudent({ ...newStudent, first_name: v })} />
                <FormField label="นามสกุล" required value={newStudent.last_name}
                  onChange={v => setNewStudent({ ...newStudent, last_name: v })} />
              </div>

              {/* School */}
              <FormField label="โรงเรียน" required>
                {ctl => (
                  <select {...ctl} value={newStudent.school_id} onChange={(e) => setNewStudent({ ...newStudent, school_id: e.target.value })}
                    className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition" required>
                    <option value="">— เลือกโรงเรียน —</option>
                    {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
              </FormField>

              {/* Grade + Classroom */}
              <div className="grid grid-cols-2 gap-3">
                <FormField label="ระดับชั้น" value={newStudent.grade}
                  onChange={v => setNewStudent({ ...newStudent, grade: v })} placeholder="เช่น ป.1, ม.3" />
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
                <p className="text-xs font-medium text-ink-muted mb-3">ข้อมูลผู้ปกครอง</p>
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
                    {phoneError && <p className="text-xs text-danger-ink mt-1">{phoneError}</p>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block text-sm text-gray-600 mb-1.5">เหตุผล <span className="text-ink-muted">(ไม่บังคับ)</span></label>
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
        <LoadingState />
      ) : requests.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="ยังไม่มีคำขอ"
          description='กดปุ่ม "สร้างคำขอ" เพื่อเริ่มต้น'
        />
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
              <h2 className="text-sm font-semibold text-ink-muted mb-2">สำเร็จแล้ว ({resolved.length})</h2>
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
            {isNew && <span className="text-xs text-warn-ink ml-1">(ใหม่)</span>}
          </p>
          <p className="text-xs text-ink-muted mt-0.5">
            {formatGradeClass(r.grade, r.classroom, '')}
            {r.reason && <>{r.grade ? ' · ' : ''}{r.reason}</>}
            {!r.grade && !r.reason && '-'}
          </p>
          <p className="text-xs text-ink-muted mt-1">
            {new Date(r.created_at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {r.review_note && <> · <span className="text-ink-muted">หมายเหตุ: {r.review_note}</span></>}
          </p>
        </div>
        <ApprovalBadge status={r.status} />
      </div>
    </div>
  );
}
