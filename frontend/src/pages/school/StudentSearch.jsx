import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

const PREFIX_OPTIONS = ['เด็กชาย', 'เด็กหญิง', 'นาย', 'นางสาว', 'นาง'];

export default function StudentSearch() {
  const navigate = useNavigate();
  const toast = useToast();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ page: 1, per_page: 20, total: 0 });

  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Edit modal state
  const [editStudent, setEditStudent] = useState(null);
  const [form, setForm] = useState({});
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [saving, setSaving] = useState(false);

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchStudents = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('per_page', '20');
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (grade) params.set('grade', grade);

      const res = await api.get(`/school/students?${params}`);
      setStudents(res.data.data);
      setMeta(res.data.meta);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, grade]);

  useEffect(() => {
    fetchStudents(1);
  }, [fetchStudents]);

  function openEdit(student) {
    setEditStudent(student);
    setForm({
      prefix: student.prefix || '',
      first_name: student.first_name || '',
      last_name: student.last_name || '',
      grade: student.grade || '',
      classroom: student.classroom || '',
      morning_enabled: !!student.morning_enabled,
      evening_enabled: !!student.evening_enabled,
      parent_name: student.parent_name || '',
      parent_phone: student.parent_phone || '',
    });
    setSelectedVehicle(student.vehicle_id || '');
    api.get('/school/vehicles/all')
      .then(r => setVehicles(r.data.data || []))
      .catch(() => setVehicles([]));
  }

  function closeEdit() {
    setEditStudent(null);
    setForm({});
    setSelectedVehicle('');
  }

  // Save student info
  async function handleSaveProfile() {
    if (!editStudent) return;
    if (!form.first_name.trim()) { toast.error('กรุณากรอกชื่อนักเรียน'); return; }
    if (!form.last_name.trim()) { toast.error('กรุณากรอกนามสกุลนักเรียน'); return; }
    if (form.parent_phone && !/^\d{9,10}$/.test(form.parent_phone)) {
      toast.error('เบอร์โทรผู้ปกครองต้องเป็นตัวเลข 9-10 หลัก');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/school/students/${editStudent.id}`, form);
      toast.success('บันทึกข้อมูลนักเรียนเรียบร้อยแล้ว');
      closeEdit();
      fetchStudents(meta.page);
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถบันทึกได้');
    } finally { setSaving(false); }
  }

  // Save vehicle change
  async function handleSaveVehicle() {
    if (!editStudent) return;
    setSaving(true);
    try {
      await api.post('/school/students/move', {
        student_id: editStudent.id,
        vehicle_id: selectedVehicle || null,
      });
      const action = !editStudent.vehicle_id ? 'เพิ่มนักเรียนเข้ารถ' :
        !selectedVehicle ? 'ลบนักเรียนออกจากรถ' : 'เปลี่ยนรถ';
      toast.success(`${action}เรียบร้อยแล้ว`);
      closeEdit();
      fetchStudents(meta.page);
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถบันทึกได้');
    } finally { setSaving(false); }
  }

  // Withdraw (soft delete)
  async function handleWithdraw() {
    if (!editStudent) return;
    if (!window.confirm(`ยืนยันลบ "${editStudent.prefix}${editStudent.first_name} ${editStudent.last_name}" ออกจากระบบ?\n\nนักเรียนจะถูกซ่อนจากรายการทั้งหมด ข้อมูลประวัติยังคงอยู่`)) return;
    setSaving(true);
    try {
      await api.delete(`/school/students/${editStudent.id}`);
      toast.success('ปรับสถานะนักเรียนเรียบร้อยแล้ว');
      closeEdit();
      fetchStudents(meta.page);
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถบันทึกได้');
    } finally { setSaving(false); }
  }

  // Import handlers
  function handleDownloadTemplate() {
    const link = document.createElement('a');
    link.href = '/templates/student_import_template_th.csv';
    link.download = 'student_import_template_th.csv';
    link.click();
  }

  async function handleImport() {
    if (!importFile) { toast.error('กรุณาเลือกไฟล์'); return; }
    setImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      const res = await api.post('/school/students/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(res.data.data);
      toast.success(res.data.message);
      fetchStudents(1);
    } catch (err) {
      toast.error(err.response?.data?.message || 'นำเข้าข้อมูลไม่สำเร็จ');
    } finally {
      setImporting(false);
      setImportFile(null);
    }
  }

  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold text-gray-800">ค้นหานักเรียน</h1>
        <div className="flex gap-2">
          <button onClick={handleDownloadTemplate}
            className="text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg transition">
            ดาวน์โหลดไฟล์ตัวอย่าง
          </button>
          <button onClick={() => { setShowImport(true); setImportResult(null); setImportFile(null); }}
            className="text-xs bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 px-3 py-1.5 rounded-lg transition">
            นำเข้าข้อมูลนักเรียน
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาชื่อ นามสกุล หรือรหัส…"
          className="flex-1 min-w-[200px] border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <select value={grade} onChange={(e) => setGrade(e.target.value)}
          className="border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
          <option value="">ทุกระดับชั้น</option>
          {['อ.1','อ.2','อ.3','ป.1','ป.2','ป.3','ป.4','ป.5','ป.6','ม.1','ม.2','ม.3','ม.4','ม.5','ม.6'].map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>
      )}

      {loading ? (
        <p className="text-gray-400 py-10 text-center">กำลังโหลด…</p>
      ) : students.length === 0 ? (
        <p className="text-gray-400 py-10 text-center">ไม่พบนักเรียน</p>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-left">
                  <th className="px-4 py-3 font-medium">รหัส</th>
                  <th className="px-4 py-3 font-medium">ชื่อ-นามสกุล</th>
                  <th className="px-4 py-3 font-medium">ชั้น/ห้อง</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap text-center">ทะเบียนรถ</th>
                  <th className="px-4 py-3 font-medium">เช้า</th>
                  <th className="px-4 py-3 font-medium">เย็น</th>
                  <th className="px-4 py-3 font-medium">ผู้ปกครอง</th>
                  <th className="px-4 py-3 font-medium text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {students.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-600">{s.id}</td>
                    <td className="px-4 py-3 text-gray-800">{s.prefix}{s.first_name} {s.last_name}</td>
                    <td className="px-4 py-3 text-gray-600">{s.grade && s.classroom ? `${s.grade}/${s.classroom}` : s.grade || s.classroom || '-'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-center align-middle">
                      {s.plate_no ? (
                        <button onClick={() => navigate(`/school/vehicles?plate=${encodeURIComponent(s.plate_no)}`)}
                          className="text-blue-600 hover:text-blue-800 hover:underline text-sm whitespace-nowrap">{s.plate_no}</button>
                      ) : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      {s.morning_enabled ? <span className="text-green-600 text-xs font-medium">ใช้</span> : <span className="text-gray-400 text-xs">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      {s.evening_enabled ? <span className="text-green-600 text-xs font-medium">ใช้</span> : <span className="text-gray-400 text-xs">-</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {s.parent_name ? <span>{s.parent_name} <span className="text-gray-400">{s.parent_phone}</span></span> : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => openEdit(s)}
                        className="text-xs text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1 rounded-lg transition">
                        แก้ไข
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
            <span>แสดง {students.length} จาก {meta.total} รายการ</span>
            <div className="flex gap-2">
              <button onClick={() => fetchStudents(meta.page - 1)} disabled={meta.page <= 1}
                className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30">ก่อนหน้า</button>
              <span className="px-3 py-1">หน้า {meta.page}/{totalPages}</span>
              <button onClick={() => fetchStudents(meta.page + 1)} disabled={meta.page >= totalPages}
                className="px-3 py-1 border rounded-lg hover:bg-gray-50 disabled:opacity-30">ถัดไป</button>
            </div>
          </div>
        </>
      )}

      {/* ── Import Modal ── */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowImport(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-800 mb-1">นำเข้าข้อมูลนักเรียน</h2>
            <p className="text-xs text-gray-400 mb-5">อัปโหลดไฟล์ CSV หรือ Excel (.xlsx) ที่กรอกข้อมูลตาม Template</p>

            {!importResult ? (
              <div className="space-y-4">
                <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border file:border-gray-200 file:text-sm file:bg-gray-50 file:text-gray-700 hover:file:bg-gray-100"
                  />
                  {importFile && (
                    <p className="text-sm text-green-600 mt-2">{importFile.name}</p>
                  )}
                </div>

                <div className="flex gap-2">
                  <button onClick={handleImport} disabled={importing || !importFile}
                    className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition">
                    {importing ? 'กำลังนำเข้า…' : 'นำเข้าข้อมูล'}
                  </button>
                  <button onClick={() => setShowImport(false)}
                    className="px-4 text-gray-500 hover:text-gray-700 text-sm py-2.5 transition">
                    ยกเลิก
                  </button>
                </div>

                <button onClick={handleDownloadTemplate}
                  className="w-full text-xs text-blue-600 hover:text-blue-800 py-1">
                  ยังไม่มีไฟล์? ดาวน์โหลดไฟล์ตัวอย่างก่อน
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Success summary */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-green-800 font-medium text-sm">
                    นำเข้าสำเร็จ {importResult.success} รายการ
                    {importResult.vehicle_linked > 0 && ` (ผูกรถ ${importResult.vehicle_linked} คน)`}
                  </p>
                </div>

                {/* Error details */}
                {importResult.errors?.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-red-700 font-medium text-sm mb-2">ไม่สำเร็จ {importResult.errors.length} รายการ</p>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {importResult.errors.map((e, i) => (
                        <p key={i} className="text-xs text-red-600">
                          แถวที่ {e.row}: {e.message}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                <button onClick={() => { setShowImport(false); setImportResult(null); }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5 rounded-lg transition">
                  ปิด
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeEdit}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-800 mb-1">แก้ไขข้อมูลนักเรียน</h2>
            <p className="text-xs text-gray-400 mb-5">รหัส: {editStudent.id}</p>

            {/* ── Section 1: ข้อมูลนักเรียน ── */}
            <fieldset className="space-y-3 mb-6">
              <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">ข้อมูลนักเรียน</legend>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">คำนำหน้า</label>
                  <select value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="">-</option>
                    {PREFIX_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ชื่อ <span className="text-red-500">*</span></label>
                  <input type="text" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">นามสกุล <span className="text-red-500">*</span></label>
                  <input type="text" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ระดับชั้น</label>
                  <select value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="">-</option>
                    {['อ.1','อ.2','อ.3','ป.1','ป.2','ป.3','ป.4','ป.5','ป.6','ม.1','ม.2','ม.3','ม.4','ม.5','ม.6'].map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ห้อง</label>
                  <input type="text" value={form.classroom} onChange={(e) => setForm({ ...form, classroom: e.target.value })}
                    placeholder="เช่น 1, 2/1"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={form.morning_enabled} onChange={(e) => setForm({ ...form, morning_enabled: e.target.checked })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-400" />
                  ใช้บริการรอบเช้า
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={form.evening_enabled} onChange={(e) => setForm({ ...form, evening_enabled: e.target.checked })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-400" />
                  ใช้บริการรอบเย็น
                </label>
              </div>
            </fieldset>

            {/* ── Section 2: ผู้ปกครอง ── */}
            <fieldset className="space-y-3 mb-6">
              <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">ผู้ปกครอง</legend>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">ชื่อผู้ปกครอง</label>
                  <input type="text" value={form.parent_name} onChange={(e) => setForm({ ...form, parent_name: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">เบอร์โทรผู้ปกครอง</label>
                  <input type="tel" value={form.parent_phone} maxLength={10}
                    onChange={(e) => setForm({ ...form, parent_phone: e.target.value.replace(/\D/g, '') })}
                    placeholder="0812345678"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
            </fieldset>

            {/* ── Section 3: รถรับส่ง ── */}
            <fieldset className="space-y-3 mb-6">
              <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">รถรับส่ง</legend>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  รถปัจจุบัน: <span className="text-gray-700 font-medium">{editStudent.plate_no || 'ยังไม่มีรถ'}</span>
                </label>
                <select value={selectedVehicle} onChange={(e) => setSelectedVehicle(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">— ไม่มีรถ —</option>
                  {vehicles.map(v => (
                    <option key={v.id} value={v.id}>{v.plate_no}{v.vehicle_type ? ` (${v.vehicle_type})` : ''}</option>
                  ))}
                </select>
              </div>
            </fieldset>

            {/* ── Actions ── */}
            <div className="flex flex-col gap-2">
              {/* Save profile */}
              <button onClick={handleSaveProfile} disabled={saving}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition">
                {saving ? 'กำลังบันทึก…' : 'บันทึกข้อมูลนักเรียน'}
              </button>

              {/* Save vehicle (only if changed) */}
              {selectedVehicle !== (editStudent.vehicle_id || '') && (
                <button onClick={handleSaveVehicle} disabled={saving}
                  className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition">
                  {saving ? 'กำลังบันทึก…' : selectedVehicle ? (editStudent.vehicle_id ? 'เปลี่ยนรถ' : 'เพิ่มเข้ารถ') : 'ลบออกจากรถ'}
                </button>
              )}

              {/* Withdraw */}
              <button onClick={handleWithdraw} disabled={saving}
                className="w-full bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-sm py-2 rounded-lg transition disabled:opacity-40">
                ลาออก / ลบออกจากระบบ
              </button>

              <button onClick={closeEdit} className="w-full text-gray-500 hover:text-gray-700 text-sm py-2 transition">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
