import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/axios';
import LoadingState from '../../components/LoadingState';
import { AlertBanner, FormField, Modal } from '../../components/ui';
import VehicleSelect from '../../components/VehicleSelect';
import { useAuth } from '../../hooks/useAuth';
import { getGradeScope } from '../../utils/authScope';

const GRADES = ['อ.1','อ.2','อ.3','ป.1','ป.2','ป.3','ป.4','ป.5','ป.6','ม.1','ม.2','ม.3','ม.4','ม.5','ม.6'];
const INPUT = 'focus-ring w-full border border-surface-border bg-surface-raised rounded-lg px-3 min-h-[44px] text-base';
const PRIMARY = 'focus-ring min-h-[48px] px-4 rounded-lg bg-brand-600 text-white font-semibold disabled:opacity-50';
const SECONDARY = 'focus-ring min-h-[44px] px-4 rounded-lg border border-surface-border text-ink hover:bg-surface';
const EMPTY = { code: '', prefix: 'เด็กชาย', first: '', last: '', grade: '', classroom: '', parent: '', phone: '' };

// Reuse the existing import validator and idempotent apply. No new create API,
// automatic guardian replacement, pupil reactivation, or vehicle creation.
export default function AddStudentModal({ initialVehicleId = '', onClose, onApplied }) {
  const { user } = useAuth();
  const gradeScope = user?.role === 'school' ? getGradeScope(user) : null;
  const [form, setForm] = useState({ ...EMPTY, grade: gradeScope || '' });
  const [vehicles, setVehicles] = useState([]);
  const [vehicleId, setVehicleId] = useState('');
  const [vehicleError, setVehicleError] = useState('');
  const [loadingVehicles, setLoadingVehicles] = useState(true);
  const [vehicleAttempt, setVehicleAttempt] = useState(0);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [applyAttempted, setApplyAttempted] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let alive = true;
    setLoadingVehicles(true); setVehicleError('');
    api.get('/school/vehicles/all').then(r => {
      if (!alive) return;
      if (!Array.isArray(r.data?.data)) throw new Error('invalid vehicle list');
      setVehicles(r.data.data);
      const selected = r.data.data.find(v => String(v.id) === String(initialVehicleId));
      if (selected) setVehicleId(selected.id);
      else if (initialVehicleId) setVehicleError('ไม่พบรถที่เลือก กรุณาปิดหน้าต่างแล้วเลือกรถใหม่');
    }).catch(() => { if (alive) setVehicleError('โหลดรายการรถไม่สำเร็จ กรุณาลองอีกครั้ง'); })
      .finally(() => { if (alive) setLoadingVehicles(false); });
    return () => { alive = false; };
  }, [initialVehicleId, vehicleAttempt]);
  const vehicle = vehicles.find(v => v.id === vehicleId);
  const update = key => value => setForm(f => ({ ...f, [key]: value }));

  async function check(e) {
    e.preventDefault();
    if (lock.current || loadingVehicles || vehicleError) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const cell = value => `"${String(value).replace(/"/g, '""')}"`;
      const headers = ['รหัสนักเรียน*','คำนำหน้า','ชื่อ*','นามสกุล*','ชั้น','ห้อง','ชื่อผู้ปกครอง','เบอร์โทรผู้ปกครอง','ทะเบียนรถ'];
      const values = [form.code.trim(),form.prefix,form.first.trim(),form.last.trim(),form.grade,form.classroom.trim(),form.parent.trim(),form.phone,vehicle?.display_plate || vehicle?.plate_no || ''];
      const file = new Blob(['\uFEFF' + headers.map(cell).join(',') + '\r\n' + values.map(cell).join(',')], { type: 'text/csv;charset=utf-8' });
      const fd = new FormData(); fd.append('file', file, 'student.csv'); fd.append('auto_create_vehicle', 'false');
      const r = await api.post('/school/students/import/preview', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const result = r.data?.data;
      if (!result?.batch_id || result.rows?.length !== 1) throw new Error('unexpected preview');
      setPreview(result);
    } catch (err) { setError(err.response?.data?.message || 'ตรวจสอบข้อมูลไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ กรุณาลองอีกครั้ง'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save() {
    if (lock.current || saved || !preview?.rows[0]?.can_apply) return;
    lock.current = true; setBusy(true); setError(''); setApplyAttempted(true);
    try {
      await api.post(`/school/students/import/${preview.batch_id}/apply`, {
        mode: 'insert_ready', selected_row_ids: [], confirm_guardian_update: false,
        confirm_reactivate: false, auto_create_vehicle: false,
      });
      const r = await api.get(`/school/students/import/${preview.batch_id}/report`);
      const result = r.data?.data?.rows?.[0];
      if (result?.status === 'ALREADY_APPLIED') {
        // A concurrent batch may have created this code with a DIFFERENT bus.
        // Replaying this same successful batch retains APPLIED, not this status.
        setPreview(p => ({ ...p, rows: [{ ...p.rows[0], can_apply: false,
          message_th: 'มีรหัสนักเรียนนี้แล้ว ระบบไม่ได้เปลี่ยนข้อมูลหรือรถตามแบบฟอร์มนี้ กรุณากลับไปตรวจรายชื่อเดิม' }] }));
        onApplied?.(); return;
      }
      if (result?.status !== 'APPLIED') {
        setError(result?.message_th || 'ยังบันทึกไม่สำเร็จ กรุณาตรวจสอบรายการในประวัติการนำเข้า'); return;
      }
      setSaved(true); onApplied?.();
    } catch (err) { setError(err.response?.data?.message || 'ยังยืนยันผลบันทึกไม่ได้ กดตรวจสอบผลอีกครั้งได้โดยไม่เพิ่มชื่อซ้ำ'); }
    finally { lock.current = false; setBusy(false); }
  }
  function nextPupil() {
    setForm(f => ({ ...EMPTY, grade: f.grade, classroom: f.classroom }));
    setPreview(null); setSaved(false); setApplyAttempted(false); setError('');
    // Keep this bus and classroom for the next child. Never persist pupil PII
    // in localStorage and never resubmit the previous batch.
  }
  const row = preview?.rows[0];
  return (
    <Modal title={saved ? 'เพิ่มนักเรียนแล้ว' : 'เพิ่มนักเรียนทีละคน'} size="lg" dismissible={!busy} onClose={onClose}>
      {saved ? <div className="space-y-4">
        <AlertBanner variant="success" title="บันทึกเรียบร้อย">{row.student_name} · {vehicle?.display_plate || vehicle?.plate_no || 'ยังไม่ได้เลือกรถ'}</AlertBanner>
        <p className="text-sm text-ink-muted">{vehicleId ? 'เพิ่มชื่อและเลือกรถแล้ว พร้อมเช็กชื่อรอบเช้าและเย็น ไม่ต้องเลือกรถอีกหน้า' : 'ก่อนเช็กชื่อ ให้เลือกรถรับส่งในรายชื่อนักเรียนก่อน'}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={PRIMARY} onClick={nextPupil}>{vehicleId ? 'เพิ่มคนถัดไปในรถคันเดิม' : 'เพิ่มนักเรียนอีกคน'}</button>
          <button type="button" className={SECONDARY} onClick={onClose}>กลับไปดูรายชื่อ</button>
          {vehicleId && <Link className={`${SECONDARY} inline-flex items-center`} to="/school/teacher-check">ไปเช็กชื่อวันนี้</Link>}
        </div>
      </div> : preview ? <div className="space-y-4">
        <p className="text-sm text-ink-muted">ตรวจสอบชื่อและรถก่อนบันทึก</p>
        <dl className="space-y-2 rounded-xl border border-surface-border p-4">
          <div><dt className="text-sm text-ink-muted">นักเรียน</dt><dd className="font-semibold">{row.student_name} · รหัส {row.student_code}</dd></div>
          <div><dt className="text-sm text-ink-muted">ชั้น / ห้อง</dt><dd>{form.grade || 'ยังไม่ระบุ'} {form.classroom && `/ ${form.classroom}`}</dd></div>
          <div><dt className="text-sm text-ink-muted">รถรับส่ง</dt><dd>{row.matched_display_plate || vehicle?.plate_no || 'ยังไม่เลือกรถ'}</dd></div>
          <div><dt className="text-sm text-ink-muted">รอบที่ใช้รถ</dt><dd>เช้าและเย็น · แก้ไขได้ในข้อมูลนักเรียน</dd></div>
        </dl>
        {!row.can_apply && <AlertBanner variant="warn" title="ยังเพิ่มรายการนี้ไม่ได้">{row.message_th || 'กรุณาตรวจสอบรายชื่อนักเรียนเดิมก่อน'} {row.classification === 'SKIP_DUPLICATE_SAME_SCHOOL' && 'ใช้รายชื่อเดิมได้เลย ไม่ต้องเพิ่มอีกครั้ง'}</AlertBanner>}
        {error && <AlertBanner variant="danger" title="ตรวจสอบผลบันทึก">{error}</AlertBanner>}
        <div className="flex flex-wrap gap-2">
          {!applyAttempted && <button type="button" disabled={busy} className={SECONDARY} onClick={() => { setPreview(null); setError(''); }}>กลับไปแก้ไข</button>}
          {row.can_apply && <button type="button" disabled={busy} className={PRIMARY} onClick={save}>{busy ? 'กำลังบันทึก…' : applyAttempted ? 'ตรวจสอบผลอีกครั้ง' : 'ยืนยันเพิ่มนักเรียน'}</button>}
          <button type="button" disabled={busy} className={SECONDARY} onClick={onClose}>กลับไปดูรายชื่อ</button>
        </div>
      </div> : <form onSubmit={check} className="space-y-5">
        <p className="text-sm text-ink-muted">กรอกชื่อและเลือกรถในหน้านี้ครั้งเดียว เพิ่มคนถัดไปใช้รถคันเดิมได้</p>
        <fieldset disabled={busy} className="space-y-3">
          <legend className="font-semibold mb-3">1. ข้อมูลนักเรียน</legend>
          <FormField label="รหัสนักเรียน" required inputMode="numeric" value={form.code} onChange={update('code')} helper="ใช้รหัสประจำตัวนักเรียนของโรงเรียน" />
          <FormField label="คำนำหน้า">{ctl => <select {...ctl} className={INPUT} value={form.prefix} onChange={e => update('prefix')(e.target.value)}>{['เด็กชาย','เด็กหญิง','นาย','นางสาว','นาง'].map(v => <option key={v}>{v}</option>)}</select>}</FormField>
          <div className="grid sm:grid-cols-2 gap-3"><FormField label="ชื่อ" required value={form.first} onChange={update('first')} /><FormField label="นามสกุล" required value={form.last} onChange={update('last')} /></div>
          <div className="grid grid-cols-2 gap-3"><FormField label="ชั้น">{ctl => <select {...ctl} className={INPUT} value={form.grade} onChange={e => update('grade')(e.target.value)} disabled={!!gradeScope}><option value="">เลือกชั้น</option>{(gradeScope ? [gradeScope] : GRADES).map(v => <option key={v}>{v}</option>)}</select>}</FormField><FormField label="ห้อง" value={form.classroom} onChange={update('classroom')} /></div>
        </fieldset>
        <fieldset disabled={busy || loadingVehicles} className="space-y-3">
          <legend className="font-semibold mb-3">2. เลือกรถรับส่ง</legend>
          {loadingVehicles ? <LoadingState message="กำลังโหลดรายการรถ…" /> : <VehicleSelect vehicles={vehicles} value={vehicleId} onChange={setVehicleId} />}
          {vehicleError && <AlertBanner variant="danger" title="เลือกรถไม่สำเร็จ">{vehicleError}<button type="button" className={`${SECONDARY} block mt-2`} onClick={() => setVehicleAttempt(n => n + 1)}>โหลดรถอีกครั้ง</button></AlertBanner>}
          <p className="text-sm text-ink-muted">ใช้รถรอบเช้าและเย็นเป็นค่าเริ่มต้น หากยังไม่ทราบรถ บันทึกชื่อไว้ก่อนแล้วเลือกรถภายหลังได้</p>
        </fieldset>
        <fieldset disabled={busy} className="space-y-3">
          <legend className="font-semibold mb-3">3. ผู้ปกครอง (ถ้ามีข้อมูล)</legend>
          <FormField label="ชื่อผู้ปกครอง" value={form.parent} onChange={update('parent')} />
          <FormField label="เบอร์โทรผู้ปกครอง" type="tel" inputMode="numeric" maxLength={10} value={form.phone} onChange={v => update('phone')(v.replace(/\D/g, ''))} />
        </fieldset>
        {error && <AlertBanner variant="danger" title="ตรวจสอบข้อมูลไม่สำเร็จ">{error}</AlertBanner>}
        <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy || loadingVehicles || !!vehicleError} className={PRIMARY}>{busy ? 'กำลังตรวจสอบ…' : 'ตรวจสอบก่อนบันทึก'}</button><button type="button" disabled={busy} onClick={onClose} className={SECONDARY}>ยกเลิก</button></div>
      </form>}
    </Modal>
  );
}
