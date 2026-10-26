import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import ErrorState from '../../components/ErrorState';
import PageHeader from '../../components/PageHeader';
import {
  DataTable, TableAction, FilterBar, FormField, Modal, ConfirmDialog, StatusBadge,
} from '../../components/ui';
import ImportPreviewModal from './ImportPreviewModal';
import ImportHistoryModal from './ImportHistoryModal';
import StudentTransferModal from './StudentTransferModal';
import AddStudentModal from './AddStudentModal';
import SchoolWorkflowNav from '../../components/SchoolWorkflowNav';
import VehicleSelect from '../../components/VehicleSelect';
import Pagination from '../../components/Pagination';
import { useAuth } from '../../hooks/useAuth';
import { isGradeTeacher } from '../../utils/authScope';
import { formatGradeClass } from '../../utils/student';

// Mask parent phone in list views for PDPA compliance — shows first 3 and
// last 2 digits only (e.g. 081****67). The edit form shows the full number
// because the school needs it to make changes.
function maskPhone(s) {
  if (!s) return '';
  const d = String(s).replace(/\D/g, '');
  if (d.length < 5) return d;
  return d.slice(0, 3) + '****' + d.slice(-2);
}

const PREFIX_OPTIONS = ['เด็กชาย', 'เด็กหญิง', 'นาย', 'นางสาว', 'นาง'];

export default function StudentSearch() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const isTeacher = isGradeTeacher(user); // read-only for grade teacher
  const [params, setParams] = useSearchParams();
  const [showAdd, setShowAdd] = useState(false);
  useEffect(() => { if (!isTeacher && params.get('add') === 'one') setShowAdd(true); }, [isTeacher, params]);
  function closeAdd() {
    setShowAdd(false);
    const next = new URLSearchParams(params); next.delete('add'); next.delete('vehicle_id');
    setParams(next, { replace: true });
  }
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ page: 1, per_page: 20, total: 0 });

  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('');
  // การ์ด "ความครบถ้วนข้อมูล" บนหน้าภาพรวมลิงก์มาที่นี่พร้อม ?has_vehicle=no
  // เพื่อให้กด "ดูรายชื่อ" แล้วเห็นเฉพาะคนที่ยังไม่ผูกรถทันที
  const [hasVehicle, setHasVehicle] = useState(
    () => new URLSearchParams(window.location.search).get('has_vehicle') || ''
  );
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Edit modal state
  const [editStudent, setEditStudent] = useState(null);
  const [editMode, setEditMode] = useState('profile');
  const [form, setForm] = useState({});
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehiclesError, setVehiclesError] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [transferStudent, setTransferStudent] = useState(null);
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
      if (hasVehicle) params.set('has_vehicle', hasVehicle);

      const res = await api.get(`/school/students?${params}`);
      setStudents(Array.isArray(res.data.data) ? res.data.data : []);
      setMeta(res.data.meta);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, grade, hasVehicle]);

  useEffect(() => {
    fetchStudents(1);
  }, [fetchStudents]);

  function loadVehicles() {
    setVehiclesLoading(true); setVehiclesError('');
    api.get('/school/vehicles/all')
      .then(r => { if (!Array.isArray(r.data?.data)) throw new Error('invalid vehicles'); setVehicles(r.data.data); })
      .catch(() => setVehiclesError('โหลดรายการรถไม่สำเร็จ กรุณาลองอีกครั้ง'))
      .finally(() => setVehiclesLoading(false));
  }

  function openEdit(student, mode = 'profile') {
    if (isTeacher) return;
    setEditMode(mode);
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
    if (mode === 'vehicle') loadVehicles();
  }

  function closeEdit() {
    setEditStudent(null);
    setForm({});
    setSelectedVehicle('');
  }

  async function handleSaveProfile() {
    // Phase 10.3E final rule — single save action.
    // The backend treats any parent_name/parent_phone change as a per-student
    // parent reassignment (detach + create new parent + link this student
    // only). No more shared-parent UPDATE from the student-edit screen, so
    // there are no longer separate "edit shared" vs "reassign" buttons.
    if (!editStudent || saveLock.current) return;
    if (!form.first_name.trim()) { toast.error('กรุณากรอกชื่อนักเรียน'); return; }
    if (!form.last_name.trim()) { toast.error('กรุณากรอกนามสกุลนักเรียน'); return; }
    if (form.parent_phone && !/^\d{9,10}$/.test(form.parent_phone)) {
      toast.error('เบอร์โทรผู้ปกครองต้องเป็นตัวเลข 9-10 หลัก');
      return;
    }
    saveLock.current = true; setSaving(true);
    try {
      const res = await api.put(`/school/students/${editStudent.id}`, form);
      toast.success('บันทึกข้อมูลนักเรียนเรียบร้อยแล้ว');
      // If the backend reassigned the parent (any change to name/phone),
      // surface a notice — the freshly-created parent row has no LINE
      // binding until the parent re-links via LINE OA.
      if (res.data?.data?.parent_reassigned) {
        if (typeof toast.info === 'function') {
          toast.info('ผู้ปกครองใหม่ยังไม่ได้ผูกบัญชี LINE');
        } else {
          console.info('[student-edit] parent reassigned — new parent has no LINE binding');
        }
      }
      closeEdit();
      fetchStudents(meta.page);
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถบันทึกได้');
    } finally { saveLock.current = false; setSaving(false); }
  }

  async function handleSaveVehicle() {
    if (!editStudent || saveLock.current || vehiclesLoading || vehiclesError) return;
    saveLock.current = true; setSaving(true);
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
    } finally { saveLock.current = false; setSaving(false); }
  }

  // Replaces window.confirm, which could not show the pupil being withdrawn in
  // any readable form and put the destructive default under Enter.
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  async function handleWithdraw() {
    if (!editStudent) return;
    setConfirmWithdraw(false);
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

  function handleDownloadTemplate() {
    const link = document.createElement('a');
    link.href = '/templates/student_import_template_th.csv';
    link.download = 'แบบฟอร์มนำเข้านักเรียน.csv';
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

  const hasFilter = Boolean(debouncedSearch || grade || hasVehicle);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <SchoolWorkflowNav current="students" />
      <PageHeader
        title="นักเรียน"
        subtitle="เพิ่มชื่อพร้อมเลือกรถในครั้งเดียว แล้วไปเช็กชื่อได้เลย"
        actions={!isTeacher ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setShowAdd(true)}
              className="focus-ring text-sm bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-medium px-4 min-h-[44px] rounded-lg transition">
              เพิ่มนักเรียนทีละคน
            </button>
            <button onClick={() => setShowPreview(true)}
              className="focus-ring text-sm bg-surface-raised hover:bg-surface active:bg-surface-border text-ink border border-surface-border px-3 min-h-[44px] rounded-lg transition">
              เพิ่มหลายคนจากไฟล์
            </button>
          </div>
        ) : undefined}
      />

      {!isTeacher && <details className="mb-4 rounded-lg border border-surface-border p-3">
        <summary className="focus-ring cursor-pointer text-sm text-ink min-h-[44px] flex items-center">ประวัติและเครื่องมือนำเข้าเพิ่มเติม</summary>
        <div className="flex flex-wrap gap-2 mt-2">
          <button type="button" onClick={() => setShowHistory(true)} className="focus-ring min-h-[44px] px-3 text-brand-700">ประวัติการนำเข้า</button>
          <button type="button" onClick={handleDownloadTemplate} className="focus-ring min-h-[44px] px-3 text-brand-700">ดาวน์โหลดไฟล์ตัวอย่าง</button>
          <button type="button" onClick={() => { setShowImport(true); setImportResult(null); setImportFile(null); }} className="focus-ring min-h-[44px] px-3 text-ink-muted">นำเข้าแบบเดิม (สำรอง)</button>
        </div>
      </details>}
      {showAdd && !isTeacher && <AddStudentModal initialVehicleId={params.get('vehicle_id') || ''} onClose={closeAdd} onApplied={() => fetchStudents(1)} />}

      <FilterBar
        className="mb-5"
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'ค้นหาชื่อ นามสกุล หรือรหัส…',
          label: 'ค้นหานักเรียนด้วยชื่อ นามสกุล หรือรหัส',
        }}
        filters={[{
          key: 'hasVehicle', label: 'กรองตามการผูกรถ', value: hasVehicle, onChange: setHasVehicle,
          options: [['', 'ทุกสถานะการผูกรถ'], ['no', 'ยังไม่ผูกรถ'], ['yes', 'ผูกรถแล้ว']] },
        {
          key: 'grade', label: 'กรองตามระดับชั้น', value: grade, onChange: setGrade,
          options: [['', 'ทุกระดับชั้น'], ...['อ.1','อ.2','อ.3','ป.1','ป.2','ป.3','ป.4','ป.5','ป.6','ม.1','ม.2','ม.3','ม.4','ม.5','ม.6'].map(g => [g, g])],
        }]}
        count={meta.total}
        countLabel="คน"
        onClear={() => { setSearch(''); setGrade(''); setHasVehicle(''); }}
      />

      {error && <ErrorState message={error} className="mb-4" onRetry={() => fetchStudents(meta.page)} />}

      <DataTable
        caption="รายชื่อนักเรียนของโรงเรียน"
        loading={loading}
        rows={students}
        rowKey={s2 => s2.id}
        columns={[
          { key: 'name', header: 'ชื่อ-นามสกุล', primary: true,
            cell: s2 => <span className="font-medium text-ink">{s2.prefix}{s2.first_name} {s2.last_name}</span> },
          { key: 'grade', header: 'ชั้น/ห้อง', secondary: true,
            cell: s2 => formatGradeClass(s2.grade, s2.classroom) },
          { key: 'code', header: 'รหัส', cell: s2 => <span className="tabular-nums">{s2.student_code ?? s2.id}</span> },
          { key: 'plate', header: 'ทะเบียนรถ', align: 'center',
            cell: s2 => (s2.plate_no
              ? (
                <button
                  onClick={() => navigate(`/school/vehicles?plate=${encodeURIComponent(s2.plate_no)}`)}
                  className="focus-ring inline-flex items-center min-h-[44px] px-2 -mx-2 rounded-lg whitespace-nowrap text-brand-700 hover:bg-brand-50 active:bg-brand-100 transition"
                >
                  {s2.plate_no}
                </button>
              )
              : <span className="text-ink-muted">ไม่มีรถ</span>) },
          { key: 'sessions', header: 'รอบที่ใช้', badge: true,
            /* Was a bare ✅ / — pair, which carries the state by symbol alone. */
            cell: s2 => {
              const used = [s2.morning_enabled && 'เช้า', s2.evening_enabled && 'เย็น'].filter(Boolean);
              return used.length
                ? <StatusBadge variant="success">{used.join(' · ')}</StatusBadge>
                : <StatusBadge variant="neutral">ไม่ใช้บริการ</StatusBadge>;
            } },
          { key: 'parent', header: 'ผู้ปกครอง',
            /* Phone stays masked in list view (PDPA); the edit form shows it in
               full because the school needs it to make changes. */
            cell: s2 => (s2.parent_name
              ? <span>{s2.parent_name}{s2.parent_phone && <span className="text-ink-muted tabular-nums"> {maskPhone(s2.parent_phone)}</span>}</span>
              : <span className="text-ink-muted">-</span>) },
        ]}
        actions={!isTeacher ? (s2 => (
          <>
            <TableAction tone="brand" onClick={() => openEdit(s2)}>แก้ข้อมูล</TableAction>
            <TableAction tone="neutral" onClick={() => openEdit(s2, 'vehicle')}>{s2.vehicle_id ? 'เปลี่ยนรถ' : 'เลือกรถ'}</TableAction>
          </>
        )) : undefined}
        empty={{
          icon: GraduationCap,
          title: hasFilter ? 'ไม่พบข้อมูลตามเงื่อนไขที่เลือก' : 'ยังไม่มีข้อมูลในขอบเขตนี้',
          description: hasFilter ? 'ลองเปลี่ยนคำค้นหรือตัวกรอง' : undefined,
        }}
      />

      {students.length > 0 && (
        <Pagination
          page={meta.page}
          totalPages={totalPages}
          total={meta.total}
          shown={students.length}
          onPage={(p) => fetchStudents(p)}
        />
      )}

      {/* ── Import Preview (primary, Phase 10.13A-26B) ── */}
      <ImportPreviewModal open={showPreview} onClose={() => setShowPreview(false)} onApplied={() => fetchStudents(1)} />

      {/* ── Import History & Correction Center (Phase 10.13B-5) ── */}
      <ImportHistoryModal open={showHistory} onClose={() => setShowHistory(false)} onChanged={() => fetchStudents(1)} />

      {/* ── Transfer request (Phase 10.13B-6) ──
          The import existed and the "ขอโอนย้ายนักเรียน" button set
          transferStudent, but nothing ever rendered the modal — the button
          was inert. Caught by the runtime smoke on this page. */}
      {transferStudent && (
        <StudentTransferModal
          student={transferStudent}
          onClose={() => setTransferStudent(null)}
          onChanged={() => fetchStudents(1)}
        />
      )}

      {/* ── Import Modal (legacy fallback) ── */}
      {showImport && (
        <Modal title="นำเข้าข้อมูลนักเรียน" onClose={() => setShowImport(false)}>
            <p className="text-sm text-ink-muted mb-5">อัปโหลดไฟล์ CSV หรือ Excel (.xlsx)</p>

            {!importResult ? (
              <div className="space-y-4">
                <div className="border-2 border-dashed border-surface-border rounded-lg p-6 text-center">
                  <input type="file" accept=".xlsx,.xls,.csv"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    className="focus-ring block w-full text-sm text-ink-muted file:mr-3 file:py-2.5 file:px-4 file:rounded-lg file:border file:border-surface-border file:text-sm file:bg-surface file:text-ink hover:file:bg-surface-border" />
                  {importFile && <p className="text-sm text-success-ink mt-2">{importFile.name}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={handleImport} disabled={importing || !importFile}
                    className="flex-1 bg-green-700 hover:bg-green-800 disabled:opacity-40 text-white text-sm font-medium py-3 rounded-lg transition">
                    {importing ? 'กำลังนำเข้า…' : 'นำเข้าข้อมูล'}
                  </button>
                  <button onClick={() => setShowImport(false)}
                    className="px-4 text-ink-muted hover:text-gray-700 text-sm py-3 transition">ยกเลิก</button>
                </div>
                <button onClick={handleDownloadTemplate}
                  className="w-full text-sm text-blue-600 hover:text-blue-800 py-1">
                  ดาวน์โหลดไฟล์ตัวอย่าง
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <p className="text-green-800 font-medium text-sm">
                    นำเข้าสำเร็จ {importResult.success} รายการ
                    {importResult.vehicle_linked > 0 && ` (ผูกรถ ${importResult.vehicle_linked} คน)`}
                  </p>
                </div>
                {importResult.errors?.length > 0 && (
                  <div className="bg-danger-soft border border-danger/30 rounded-lg p-4">
                    <p className="text-danger-ink font-medium text-sm mb-2">ไม่สำเร็จ {importResult.errors.length} รายการ</p>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {importResult.errors.map((e, i) => (
                        <p key={i} className="text-caption text-danger-ink">แถวที่ {e.row}: {e.message}</p>
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={() => { setShowImport(false); setImportResult(null); }}
                  className="focus-ring w-full bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-sm font-medium min-h-[48px] rounded-lg transition">
                  ปิด
                </button>
              </div>
            )}
        </Modal>
      )}

      {/* ── Edit Modal ── */}
      {editStudent && (
        <Modal size="lg" title={editMode === 'vehicle' ? 'เลือกรถรับส่งให้นักเรียน' : 'แก้ไขข้อมูลนักเรียน'} dismissible={!saving} onClose={closeEdit}>
            <p className="text-sm text-ink-muted mb-5 tabular-nums">รหัส: {editStudent.student_code ?? editStudent.id}</p>

            {editMode === 'profile' && <>
            {/* Section 1: ข้อมูลนักเรียน */}
            <fieldset disabled={saving} className="space-y-3 mb-6">
              <legend className="text-sm font-semibold text-ink mb-2">ข้อมูลนักเรียน</legend>

              <FormField label="คำนำหน้า">
                {ctl => (
                  <select {...ctl} value={form.prefix} onChange={(e) => setForm({ ...form, prefix: e.target.value })} className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition">
                    <option value="">-</option>
                    {PREFIX_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="ชื่อ" required value={form.first_name} onChange={v => setForm({ ...form, first_name: v })} />
                <FormField label="นามสกุล" required value={form.last_name} onChange={v => setForm({ ...form, last_name: v })} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="ระดับชั้น">
                  {ctl => (
                    <select {...ctl} value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition">
                      <option value="">-</option>
                      {['อ.1','อ.2','อ.3','ป.1','ป.2','ป.3','ป.4','ป.5','ป.6','ม.1','ม.2','ม.3','ม.4','ม.5','ม.6'].map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  )}
                </FormField>
                <FormField label="ห้อง" value={form.classroom} onChange={v => setForm({ ...form, classroom: v })} placeholder="เช่น 1, 2/1" />
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <label className="focus-within:outline-none inline-flex items-center gap-2 min-h-[44px] text-base text-ink cursor-pointer">
                  <input type="checkbox" checked={form.morning_enabled} onChange={(e) => setForm({ ...form, morning_enabled: e.target.checked })}
                    className="focus-ring w-5 h-5 rounded border-surface-border text-brand-600" />
                  ใช้บริการรอบเช้า
                </label>
                <label className="focus-within:outline-none inline-flex items-center gap-2 min-h-[44px] text-base text-ink cursor-pointer">
                  <input type="checkbox" checked={form.evening_enabled} onChange={(e) => setForm({ ...form, evening_enabled: e.target.checked })}
                    className="focus-ring w-5 h-5 rounded border-surface-border text-brand-600" />
                  ใช้บริการรอบเย็น
                </label>
              </div>
            </fieldset>

            {/* Section 2: ผู้ปกครอง — Phase 10.3E final rule.
                Any change to name or phone here is treated as a per-student
                parent reassignment by the backend. No buttons / no shared-edit
                workflow — the standard "บันทึกข้อมูลนักเรียน" button below
                handles save + reassign atomically. */}
            <fieldset disabled={saving} className="space-y-3 mb-6">
              <legend className="text-sm font-semibold text-ink mb-2">ผู้ปกครอง</legend>
              <div className="bg-brand-50 border border-brand-200 text-brand-800 rounded-lg px-3 py-2 text-caption leading-snug">
                ℹ️ หากเปลี่ยนเบอร์โทรหรือชื่อผู้ปกครอง ระบบจะถือว่าเป็นการ
                <span className="font-semibold"> เปลี่ยนผู้ปกครองของนักเรียนคนนี้เท่านั้น </span>
                — จะไม่กระทบนักเรียนคนอื่นที่เคยใช้ข้อมูลผู้ปกครองเดิมร่วมกัน
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="ชื่อผู้ปกครอง" value={form.parent_name} onChange={v => setForm({ ...form, parent_name: v })} />
                <FormField
                  label="เบอร์โทรผู้ปกครอง"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={form.parent_phone}
                  onChange={v => setForm({ ...form, parent_phone: v.replace(/\D/g, '') })}
                  placeholder="0812345678"
                />
              </div>
            </fieldset>

            </>}
            {editMode === 'vehicle' && <>
            <p className="font-semibold mb-3">{editStudent.prefix}{editStudent.first_name} {editStudent.last_name}</p>
            {/* Vehicle assignment is a separate task; there are no unsaved
                profile fields to discard when this endpoint completes. */}
            <fieldset disabled={saving} className="space-y-3 mb-6">
              <legend className="text-sm font-semibold text-ink mb-2">รถรับส่ง</legend>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  รถปัจจุบัน: <span className="text-ink font-semibold">{editStudent.plate_no || 'ยังไม่มีรถ'}</span>
                </label>
                {/* Phase 10.13C — searchable combobox (type to filter 100+ vehicles);
                    canonical display_plate; hides province-variant duplicates but keeps
                    the currently-assigned vehicle visible. value '' = ไม่มีรถ. */}
                {vehiclesLoading ? <p role="status">กำลังโหลดรถ…</p> : vehiclesError
                  ? <ErrorState message={vehiclesError} onRetry={loadVehicles} />
                  : <VehicleSelect vehicles={vehicles} value={selectedVehicle} onChange={setSelectedVehicle} />}
                {vehicles.some(v => v.duplicate_candidate && v.id !== selectedVehicle) && (
                  <p className="mt-1 text-caption text-ink-muted">แสดงเฉพาะรถที่ใช้งานจริง ไม่รวมรายการซ้ำที่รอจัดเก็บ</p>
                )}
              </div>
            </fieldset>
            </>}

            {/* Actions */}
            <div className="flex flex-col gap-2">
              {editMode === 'profile' && <button onClick={handleSaveProfile} disabled={saving}
                className="focus-ring w-full bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:opacity-40 disabled:pointer-events-none text-white font-medium min-h-[48px] rounded-lg transition">
                {saving ? 'กำลังบันทึก…' : 'บันทึกข้อมูลนักเรียน'}
              </button>}
              {editMode === 'vehicle' && (
                <button onClick={handleSaveVehicle} disabled={saving || vehiclesLoading || !!vehiclesError || selectedVehicle === (editStudent.vehicle_id || '')}
                  className="focus-ring w-full bg-success-ink hover:bg-success-ink/90 disabled:opacity-40 disabled:pointer-events-none text-white font-medium min-h-[48px] rounded-lg transition">
                  {saving ? 'กำลังบันทึก…' : selectedVehicle ? (editStudent.vehicle_id ? 'เปลี่ยนรถ' : 'เพิ่มเข้ารถ') : 'ลบออกจากรถ'}
                </button>
              )}
              {editMode === 'profile' && <details className="border border-surface-border rounded-lg p-3">
              <summary className="focus-ring min-h-[44px] flex items-center cursor-pointer text-sm">ย้ายโรงเรียน / นำรายชื่อออก</summary>
              <button onClick={() => setTransferStudent(editStudent)} disabled={saving}
                className="focus-ring w-full bg-warn-soft hover:bg-warn-soft/70 text-warn-ink border border-warn/30 min-h-[44px] rounded-lg transition disabled:opacity-40 disabled:pointer-events-none">
                ขอโอนย้ายนักเรียน
              </button>
              <button onClick={() => setConfirmWithdraw(true)} disabled={saving}
                className="focus-ring w-full bg-danger-soft hover:bg-danger-soft/70 text-danger-ink border border-danger/30 min-h-[44px] rounded-lg transition disabled:opacity-40 disabled:pointer-events-none">
                ลาออก / ลบออกจากระบบ
              </button>
              </details>}
              <button onClick={closeEdit}
                disabled={saving}
                className="focus-ring w-full text-ink-muted hover:text-ink hover:bg-surface min-h-[44px] rounded-lg transition">
                ยกเลิก
              </button>
            </div>
        </Modal>
      )}

      <ConfirmDialog
        open={confirmWithdraw}
        title="นำนักเรียนออกจากระบบ?"
        itemName={editStudent ? `${editStudent.prefix || ''}${editStudent.first_name} ${editStudent.last_name}` : ''}
        description="นักเรียนจะถูกซ่อนจากรายการทั้งหมด ข้อมูลประวัติยังคงอยู่ และการกระทำนี้ถูกบันทึกใน audit log"
        confirmLabel="นำออกจากระบบ"
        loading={saving}
        onConfirm={handleWithdraw}
        onCancel={() => setConfirmWithdraw(false)}
      />
    </div>
  );
}
