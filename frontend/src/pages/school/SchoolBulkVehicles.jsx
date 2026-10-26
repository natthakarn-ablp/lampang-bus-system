import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import SchoolWorkflowNav from '../../components/SchoolWorkflowNav';
import LoadingState from '../../components/LoadingState';
import { AlertBanner, FormField } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { AppCard } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { isFullSchoolAccount } from '../../utils/authScope';
import { THAI_PROVINCES, buildPlateNo } from '../../constants/provinces';

// Phase 10.13A-22 — structured plate parts (หมวดอักษร / เลขทะเบียน / จังหวัด).
// plate_no is DERIVED, never free-typed. Province defaults to ลำปาง.
const EMPTY_ROW = { plate_prefix: '', plate_number: '', plate_province: 'ลำปาง', vehicle_type: 'รถตู้', driver_name: '', driver_phone: '', owner_name: '' };
const rowPlate = (r) => buildPlateNo(r.plate_prefix, r.plate_number, r.plate_province);
const PLATE_FIELDS = ['plate_prefix', 'plate_number', 'plate_province'];

function TeacherDeniedCard() {
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <AppCard padding="lg">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-6 h-6 text-warn-ink shrink-0" strokeWidth={2} />
          <div>
            <h1 className="text-lg font-semibold text-ink mb-1">ไม่สามารถเข้าถึงหน้านี้ได้</h1>
            <p className="text-sm text-ink-muted">
              การเพิ่มรถใช้บัญชีหลักของโรงเรียน กรุณาแจ้งผู้ดูแลข้อมูลโรงเรียน
            </p>
          </div>
        </div>
      </AppCard>
    </div>
  );
}

// Shared by the selects here; FormField supplies the label wiring.
const CONTROL_CLS = 'focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition';

export default function SchoolBulkVehicles() {
  const { user } = useAuth();
  const canManage = user?.role === 'admin' || isFullSchoolAccount(user);
  const navigate = useNavigate();
  const [rows, setRows] = useState([{ ...EMPTY_ROW, key: 'row-1' }]);
  const nextRow = useRef(2);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [existingVehicles, setExistingVehicles] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searched, setSearched] = useState(false);
  const [searchPlate, setSearchPlate] = useState('');
  // Stable keys keep async checks, errors and saved receipts attached to a row
  // when another row is removed. A saved row is never posted again on retry.
  const [warnings, setWarnings] = useState({});
  const [restorePrompt, setRestorePrompt] = useState({});
  const [requestedRestore, setRequestedRestore] = useState(new Set());
  const [rowErrors, setRowErrors] = useState({});
  const [restoring, setRestoring] = useState({});
  const restoringRef = useRef(new Set());
  const checkTimers = useRef({});
  const checkVersions = useRef({});
  const searchVersion = useRef(0);
  const mounted = useRef(true);
  const toast = useToast();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      Object.values(checkTimers.current).forEach(clearTimeout);
    };
  }, []);

  // Debounced/blur duplicate preflight against the backend (source of truth).
  async function checkPlate(i, plate) {
    const p = (plate || '').trim();
    const version = (checkVersions.current[i] || 0) + 1;
    checkVersions.current[i] = version;
    if (!p) { setWarnings((w) => { const n = { ...w }; delete n[i]; return n; }); return null; }
    try {
      const res = await api.get('/school/vehicles/check-plate', { params: { plate_no: p } });
      if (!mounted.current || checkVersions.current[i] !== version) return null;
      const result = { ...res.data.data, plate: p };
      setWarnings((w) => ({ ...w, [i]: result }));
      return result;
    } catch {
      if (mounted.current && checkVersions.current[i] === version) {
        setWarnings((w) => ({ ...w, [i]: { plate: p, status: 'CHECK_FAILED' } }));
      }
      return null;
    }
  }

  // Phase 7.11.4 — render denied state for teacher AFTER all hooks are mounted.
  if (!canManage) return <TeacherDeniedCard />;

  function addRow() {
    if (savingRef.current) return;
    if (rows.length >= 10) { toast.error('สูงสุด 10 คันต่อครั้ง'); return; }
    setRows([...rows, { ...EMPTY_ROW, key: `row-${nextRow.current++}` }]);
  }
  function removeRow(i) {
    if (savingRef.current || restoringRef.current.has(i) || rows.find(r => r.key === i)?.saved) return;
    clearTimeout(checkTimers.current[i]);
    checkVersions.current[i] = (checkVersions.current[i] || 0) + 1;
    setRows(prev => prev.filter(r => r.key !== i));
    const without = (m) => { const next = { ...m }; delete next[i]; return next; };
    setWarnings(without); setRestorePrompt(without); setRowErrors(without);
    setRequestedRestore(prev => { const next = new Set(prev); next.delete(i); return next; });
  }

  function updateRow(i, field, value) {
    const row = rows.find(r => r.key === i);
    if (!row || row.saved || row.uncertain || savingRef.current || restoringRef.current.has(i)) return;
    const updated = { ...row, [field]: value };
    setRows(prev => prev.map(r => r.key === i ? updated : r));
    setRowErrors(prev => { const next = { ...prev }; delete next[i]; return next; });
    if (PLATE_FIELDS.includes(field)) {
      const plate = rowPlate(updated);
      clearTimeout(checkTimers.current[i]);
      checkVersions.current[i] = (checkVersions.current[i] || 0) + 1;
      setWarnings(prev => { const next = { ...prev }; delete next[i]; return next; });
      setRestorePrompt(prev => { const next = { ...prev }; delete next[i]; return next; });
      setRequestedRestore(prev => { const next = new Set(prev); next.delete(i); return next; });
      checkTimers.current[i] = setTimeout(() => checkPlate(i, plate), 400);
    }
  }

  async function searchExisting() {
    if (!searchPlate.trim() || savingRef.current) return;
    const version = ++searchVersion.current;
    setSearching(true);
    setSearchError('');
    setSearched(true);
    try {
      const res = await api.get('/school/vehicles/all');
      // Failed or malformed searches must not look like "this plate is free".
      if (!Array.isArray(res.data?.data)) throw new Error('Invalid vehicle list');
      const list = res.data.data;
      const q = searchPlate.trim().toLowerCase().replace(/[\s-]/g, '');
      if (version !== searchVersion.current || !mounted.current) return;
      setExistingVehicles(list.filter((v) => !v.duplicate_candidate && String(v.display_plate || v.plate_no || '').toLowerCase().replace(/[\s-]/g, '').includes(q)));
    } catch (err) {
      if (version !== searchVersion.current || !mounted.current) return;
      setSearchError(err.response?.data?.message || 'ค้นหารถไม่สำเร็จ');
      setExistingVehicles([]);
    } finally {
      if (version === searchVersion.current && mounted.current) setSearching(false);
    }
  }

  function selectExisting(v) {
    if (savingRef.current || !v.id) return;
    navigate(`/school/students?add=one&vehicle_id=${encodeURIComponent(v.id)}`);
  }

  async function handleSave() {
    if (!canManage || savingRef.current || restoringRef.current.size) return;
    const valid = rows.filter(r => !r.saved && !r.uncertain && rowPlate(r));
    if (valid.length === 0) { toast.error('กรุณากรอกหมวดอักษร เลขทะเบียน และจังหวัดให้ครบถ้วน'); return; }
    savingRef.current = true;
    setSaving(true);
    let ok = 0, fail = 0;
    for (const row of valid) {
      if (!mounted.current) break;
      const idx = row.key;
      const plate = rowPlate(row);
      clearTimeout(checkTimers.current[idx]);
      // Re-check at the point of save, including a save before debounce ends.
      // Only new plates reach POST; existing ones go to pupil assignment.
      const checked = await checkPlate(idx, plate);
      if (checked?.status !== 'CLEAR') {
        fail++;
        setRowErrors(p => ({ ...p, [idx]: checked ? 'ตรวจสอบรถที่มีอยู่แล้วด้านล่างก่อนเพิ่มรถใหม่' : 'ตรวจสอบทะเบียนไม่สำเร็จ กรุณาลองบันทึกอีกครั้ง' }));
        continue;
      }
      try {
        const res = await api.post('/school/vehicles', {
          plate_prefix: row.plate_prefix.trim(),
          plate_number: row.plate_number.trim(),
          plate_province: row.plate_province,
          plate_no: plate, // backend rebuilds canonically from the structured parts
          vehicle_type: row.vehicle_type,
          driver_name: row.driver_name.trim(),
          driver_phone: row.driver_phone.trim(),
          owner_name: (row.owner_name || '').trim(),
        });
        const saved = { vehicle_id: res.data?.data?.vehicle_id || null, plate_no: res.data?.data?.plate_no || plate };
        setRows(prev => prev.map(r => r.key === idx ? { ...r, saved } : r));
        setRowErrors(p => { const next = { ...p }; delete next[idx]; return next; });
        ok++;
      } catch (err) {
        fail++;
        const e0 = err.response?.data?.errors?.[0];
        if (!err.response) {
          // A lost response does not prove the write failed. Keep the row
          // locked and direct the user to search instead of posting again.
          setRows(prev => prev.map(r => r.key === idx ? { ...r, uncertain: true } : r));
          setRowErrors(p => ({ ...p, [idx]: 'ยังยืนยันผลบันทึกไม่ได้ กรุณาค้นหาทะเบียนด้านบนก่อนดำเนินการต่อ รายการนี้จะไม่ถูกส่งซ้ำ' }));
        } else if (e0?.code === 'SOFT_DELETED_VEHICLE_EXISTS' && e0.vehicle_id) {
          // Dead-end → offer the admin-approved restore request (10.13B-7), no auto-restore.
          setRestorePrompt((p) => ({ ...p, [idx]: { vehicle_id: e0.vehicle_id, existing_plate: e0.existing_plate || plate, plate } }));
        } else {
          setRowErrors((p) => ({ ...p, [idx]: err.response?.data?.message || 'บันทึกไม่สำเร็จ' }));
        }
      }
    }
    if (ok > 0) toast.success(`บันทึกสำเร็จ ${ok} คัน${fail > 0 ? ` · มี ${fail} คันต้องตรวจสอบด้านล่าง` : ''}`);
    else if (fail > 0) toast.error(`ยังบันทึกไม่ได้ ${fail} คัน — ดูรายละเอียดด้านล่าง`);
    savingRef.current = false;
    setSaving(false);
  }

  // A soft-deleted collision can surface in preflight or in a concurrent POST
  // conflict. Both lead to the same admin-approved restore-request action.
  function softDeletedConflict(i) {
    const c = warnings[i]?.classification;
    return c?.code === 'SOFT_DELETED_VEHICLE_EXISTS' && c.vehicle_id
      ? { vehicle_id: c.vehicle_id, existing_plate: c.display_plate }
      : null;
  }

  // Phase 10.13C — from a soft-deleted-plate collision, request a vehicle restore
  // (admin-approved, 10.13B-7). Never auto-restores; mirrors ImportPreviewModal.
  async function requestRestore(i, info) {
    if (!canManage || !info || savingRef.current || restoringRef.current.has(i) || requestedRestore.has(i)) return;
    restoringRef.current.add(i);
    setRestoring(p => ({ ...p, [i]: true }));
    try {
      await api.post('/school/vehicles/requests', {
        request_type: 'RESTORE_SOFT_DELETED_VEHICLE',
        vehicle_id: info.vehicle_id,
        input_plate: info.existing_plate || info.plate,
        reason: 'จากหน้าเพิ่มรถ — ทะเบียนตรงกับรถที่ถูกปิดใช้งานแล้ว',
      });
      setRequestedRestore((s) => new Set(s).add(i));
      toast.success('ส่งคำขอกู้คืนรถแล้ว · รอผู้ดูแลระบบตรวจสอบ');
    } catch (err) {
      if (err.response?.data?.errors?.[0]?.code === 'PENDING_REQUEST_EXISTS') {
        setRequestedRestore((s) => new Set(s).add(i));
        toast.success('มีคำขอกู้คืนรถคันนี้รออนุมัติอยู่แล้ว');
      } else { toast.error(err.response?.data?.message || 'ส่งคำขอไม่สำเร็จ'); }
    } finally {
      restoringRef.current.delete(i);
      setRestoring(p => ({ ...p, [i]: false }));
    }
  }

  const completeCount = rows.filter((r) => !r.saved && !r.uncertain && rowPlate(r)).length;
  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <SchoolWorkflowNav current="vehicles" />
      <PageHeader
        title="เพิ่มรถรับส่ง"
        subtitle="ค้นหารถเดิมก่อน ถ้ายังไม่มีจึงเพิ่มรถใหม่ แล้วเพิ่มชื่อนักเรียนขึ้นรถคันนั้นได้เลย"
        actions={<Link to="/school/vehicles" className="focus-ring inline-flex items-center min-h-[44px] px-3 rounded-lg text-brand-700 hover:bg-brand-50 text-sm font-medium">ดูรถของโรงเรียน</Link>}
      />

      {/* Search existing vehicle */}
      <AppCard padding="md" className="mb-4">
        <form
          onSubmit={(e) => { e.preventDefault(); searchExisting(); }}
          className="flex flex-col sm:flex-row sm:items-end gap-2"
        >
          <FormField
            className="flex-1 min-w-0"
            label="ค้นหารถที่มีอยู่แล้วในระบบ"
            value={searchPlate}
            onChange={(v) => { searchVersion.current++; setSearchPlate(v); setSearched(false); setSearching(false); setExistingVehicles([]); setSearchError(''); }}
            placeholder="พิมพ์ทะเบียนรถ…"
            helper="พบรถแล้วเลือกใช้ได้เลย ไม่ต้องกรอกข้อมูลรถซ้ำ"
          />
          <button
            type="submit"
            disabled={saving || searching || !searchPlate.trim()}
            className="focus-ring shrink-0 bg-brand-50 hover:bg-brand-100 active:bg-brand-200 text-brand-700 text-sm font-medium px-4 min-h-[44px] rounded-lg border border-brand-200 transition disabled:opacity-50 disabled:pointer-events-none"
          >
            {searching ? 'กำลังค้นหา…' : 'ค้นหา'}
          </button>
        </form>

        {searching ? (
          <LoadingState compact message="กำลังค้นหารถ…" />
        ) : searchError ? (
          <AlertBanner variant="danger" title="ค้นหาไม่สำเร็จ" className="mt-2">{searchError}</AlertBanner>
        ) : existingVehicles.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {existingVehicles.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => selectExisting(v)}
                  disabled={saving}
                  className="focus-ring w-full text-left text-sm px-3 py-2 min-h-[44px] bg-surface hover:bg-brand-50 rounded-lg border border-surface-border transition disabled:opacity-50"
                >
                  <span className="block font-semibold">{v.display_plate || v.plate_no}</span>
                  <span className="block text-brand-700">ใช้รถคันนี้ แล้วเพิ่มนักเรียน</span>
                </button>
              </li>
            ))}
          </ul>
        ) : searched ? (
          <p className="mt-2 text-sm text-ink-muted">ไม่พบรถที่ตรงกับคำค้นนี้ — กรอกข้อมูลรถใหม่ด้านล่างได้เลย</p>
        ) : null}
      </AppCard>

      {/* Vehicle rows */}
      <h2 className="text-base font-semibold text-ink mb-3">เพิ่มรถใหม่</h2>
      <div className="space-y-3 mb-4">
        {rows.map((r, rowIndex) => {
          const i = r.key;
          const plate = rowPlate(r);
          const restoreInfo = restorePrompt[i] || softDeletedConflict(i);
          if (r.saved) {
            return (
              <AppCard key={i} padding="md" className="border-success/30 bg-success-soft">
                <div role="status">
                  <h3 className="font-semibold text-success-ink">บันทึกรถ {r.saved.plate_no} แล้ว</h3>
                  <p className="text-sm text-ink-muted mt-1">รถจะปรากฏในรายชื่อรถของโรงเรียน เมื่อมีนักเรียนของโรงเรียนเลือกใช้รถคันนี้</p>
                </div>
                {r.saved.vehicle_id ? (
                  <Link to={`/school/students?add=one&vehicle_id=${encodeURIComponent(r.saved.vehicle_id)}`} aria-disabled={saving || undefined}
                    onClick={e => { if (savingRef.current) e.preventDefault(); }}
                    className={`focus-ring inline-flex items-center justify-center mt-3 min-h-[44px] px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold ${saving ? 'opacity-50 pointer-events-none' : ''}`}>
                    ต่อไป: เพิ่มนักเรียนขึ้นรถคันนี้
                  </Link>
                ) : (
                  <p className="text-sm text-ink mt-2">ค้นหาทะเบียนนี้ด้านบนเพื่อเลือกใช้รถ รายการที่บันทึกแล้วจะไม่ถูกส่งซ้ำ</p>
                )}
                <Link to="/school/students" aria-disabled={saving || undefined} onClick={e => { if (savingRef.current) e.preventDefault(); }}
                  className={`focus-ring flex w-fit items-center mt-2 min-h-[44px] px-3 rounded-lg text-brand-700 hover:bg-brand-50 text-sm ${saving ? 'opacity-50 pointer-events-none' : ''}`}>
                  มีชื่อนักเรียนอยู่แล้ว? ไปเลือกรถให้นักเรียน
                </Link>
              </AppCard>
            );
          }
          return (
            <AppCard key={i} padding="md">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-ink">รถใหม่คันที่ {rowIndex + 1}</span>
                {rows.length > 1 && !r.uncertain && (
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    disabled={saving || restoring[i]}
                    aria-label={`ลบรถคันที่ ${rowIndex + 1} ออกจากรายการ`}
                    className="focus-ring text-sm font-medium text-danger-ink px-2 min-h-[44px] rounded-lg hover:bg-danger-soft transition"
                  >
                    ลบ
                  </button>
                )}
              </div>

              <fieldset disabled={saving || !!restoring[i] || !!r.uncertain}>
              {/* Structured plate input */}
              <fieldset>
                <legend className="block text-sm font-medium text-ink mb-1">
                  ทะเบียนรถ
                  <span className="text-danger-ink ml-0.5" aria-hidden="true">*</span>
                  <span className="sr-only"> (จำเป็น)</span>
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  <FormField
                    label="หมวดอักษร"
                    value={r.plate_prefix}
                    maxLength={4}
                    onChange={(v) => updateRow(i, 'plate_prefix', v)}
                    placeholder="เช่น นข"
                  />
                  <FormField
                    label="เลขทะเบียน"
                    value={r.plate_number}
                    maxLength={4}
                    inputMode="numeric"
                    onChange={(v) => updateRow(i, 'plate_number', v.replace(/[^0-9]/g, ''))}
                    placeholder="เช่น 4337"
                  />
                  <FormField label="จังหวัด">
                    {ctl => (
                      <select
                        {...ctl}
                        value={r.plate_province}
                        onChange={(e) => updateRow(i, 'plate_province', e.target.value)}
                        className={CONTROL_CLS}
                      >
                        {THAI_PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    )}
                  </FormField>
                </div>
              </fieldset>
              {plate
                ? <p className="mt-1 text-sm text-ink-muted">ทะเบียนที่จะบันทึก: <span className="font-medium text-ink">{plate}</span></p>
                : <p className="mt-1 text-xs text-ink-muted">กรอกหมวดอักษร เลขทะเบียน และจังหวัดให้ครบถ้วน</p>}

              <details className="mt-3 rounded-lg border border-surface-border bg-surface-raised px-3">
                <summary className="focus-ring cursor-pointer min-h-[44px] py-3 text-sm font-medium text-ink">รายละเอียดรถและคนขับ (กรอกเพิ่มเติมได้)</summary>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <FormField label="ประเภทรถ">
                  {ctl => (
                    <select
                      {...ctl}
                      value={r.vehicle_type}
                      onChange={(e) => updateRow(i, 'vehicle_type', e.target.value)}
                      className={CONTROL_CLS}
                    >
                      <option value="รถตู้">รถตู้</option>
                      <option value="รถสองแถว">รถสองแถว</option>
                      <option value="รถบัส">รถบัส</option>
                      <option value="อื่นๆ">อื่นๆ</option>
                    </select>
                  )}
                </FormField>
                <FormField
                  label="ชื่อคนขับ"
                  value={r.driver_name}
                  onChange={(v) => updateRow(i, 'driver_name', v)}
                />
                <FormField
                  label="เบอร์โทรคนขับ"
                  type="tel"
                  inputMode="numeric"
                  value={r.driver_phone}
                  onChange={(v) => updateRow(i, 'driver_phone', v)}
                />
              </div>

              <FormField
                className="mt-3"
                label="ชื่อผู้ครอบครองรถ (เจ้าของรถ)"
                value={r.owner_name}
                maxLength={100}
                onChange={(v) => updateRow(i, 'owner_name', v)}
                placeholder="เว้นว่างได้ หากเป็นคนเดียวกับคนขับ"
              />
              <p className="text-sm text-ink-muted my-3">เมื่อระบุชื่อคนขับ ระบบจะจัดเตรียมบัญชีคนขับให้ตามข้อมูลรถนี้</p>
              </details>
              </fieldset>

              {!r.uncertain && restoreInfo ? (
                <div className="mt-2 text-xs bg-blue-50 border border-blue-300 text-blue-800 rounded-lg px-3 py-2">
                  <div className="font-medium">รถทะเบียนนี้ถูกปิดใช้งานอยู่ ({restoreInfo.existing_plate})</div>
                  <div className="mt-0.5">ต้องการใช้งานต่อ ส่งคำขอให้ผู้ดูแลระบบกู้คืนรถคันนี้ (ไม่กู้คืนทันที)</div>
                  {requestedRestore.has(i) ? (
                    <div className="mt-1.5 font-medium text-success-ink">ส่งคำขอแล้ว · รอผู้ดูแลระบบอนุมัติ</div>
                  ) : (
                    <button type="button" onClick={() => requestRestore(i, restoreInfo)} disabled={saving || restoring[i]}
                      className="focus-ring mt-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-3 min-h-[44px] rounded-lg transition disabled:opacity-50">
                      {restoring[i] ? 'กำลังส่งคำขอ…' : 'ส่งคำขอกู้คืนรถนี้'}
                    </button>
                  )}
                </div>
              ) : !r.uncertain && warnings[i]?.status === 'DUPLICATE_OR_SIMILAR' ? (
                <div className="mt-2 text-xs bg-amber-50 border border-amber-300 text-amber-800 rounded-lg px-3 py-2">
                  พบรถทะเบียนใกล้เคียงในระบบแล้ว กรุณาตรวจสอบก่อนบันทึก
                  <div className="mt-0.5 font-medium">มีอยู่แล้ว: {(warnings[i].candidates || []).map((c) => c.plate_no).join(', ')}</div>
                  <p className="mt-1">ค้นหาทะเบียนด้านบนเพื่อเลือกใช้รถเดิมกับนักเรียน</p>
                </div>
              ) : !r.uncertain && warnings[i]?.status === 'CLEAR' && plate && !rowErrors[i] ? (
                <div className="mt-2 text-xs text-success-ink">ยังไม่พบทะเบียนนี้ในระบบ</div>
              ) : null}
              {rowErrors[i] && (!restoreInfo || r.uncertain) && (
                <div className="mt-2 text-xs bg-red-50 border border-red-300 text-red-700 rounded-lg px-3 py-2">{rowErrors[i]}</div>
              )}
            </AppCard>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        {rows.length < 10 && (
          <button
            type="button"
            onClick={addRow}
            disabled={saving}
            className="focus-ring bg-surface hover:bg-surface-border text-ink text-sm font-medium px-5 min-h-[44px] rounded-lg border border-surface-border transition disabled:opacity-50"
          >
            <span aria-hidden="true">+</span> เพิ่มอีกคัน
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || completeCount === 0 || Object.values(restoring).some(Boolean)}
          className="focus-ring bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50 disabled:pointer-events-none text-white text-sm font-semibold px-5 min-h-[44px] rounded-lg transition"
        >
          {saving ? 'กำลังบันทึก…' : `บันทึกรถใหม่ ${completeCount} คัน`}
        </button>
      </div>
    </div>
  );
}
