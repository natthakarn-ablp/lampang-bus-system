import { useState, useRef } from 'react';
import { ShieldAlert } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import { AppCard } from '../../components/ui';
import { useAuth } from '../../hooks/useAuth';
import { isGradeTeacher } from '../../utils/authScope';
import { THAI_PROVINCES, buildPlateNo, normalizedLoginPlate, parsePlateParts } from '../../constants/provinces';

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
          <ShieldAlert className="w-6 h-6 text-warn shrink-0" strokeWidth={2} />
          <div>
            <h1 className="text-lg font-semibold text-ink mb-1">ไม่สามารถเข้าถึงหน้านี้ได้</h1>
            <p className="text-sm text-ink-muted">
              บัญชีครูประจำสายชั้นเข้าถึงได้เฉพาะข้อมูลสำหรับตรวจสอบเท่านั้น
              หากต้องการเพิ่มรถ กรุณาแจ้งบัญชีหลักของโรงเรียน
            </p>
          </div>
        </div>
      </AppCard>
    </div>
  );
}

export default function SchoolBulkVehicles() {
  const { user } = useAuth();
  const [rows, setRows] = useState([{ ...EMPTY_ROW }]);
  const [saving, setSaving] = useState(false);
  const [existingVehicles, setExistingVehicles] = useState([]);
  const [searchPlate, setSearchPlate] = useState('');
  // Per-row plate duplicate preflight: { [rowIndex]: { status, candidates } }
  const [warnings, setWarnings] = useState({});
  // Phase 10.13C — turn the soft-deleted-plate 409 dead-end into the existing
  // admin-approved restore-request flow (10.13B-7). restorePrompt[i] holds the
  // conflicting vehicle; requestedRestore tracks rows already requested;
  // rowErrors[i] surfaces the server reason for any other save failure.
  const [restorePrompt, setRestorePrompt] = useState({});
  const [requestedRestore, setRequestedRestore] = useState(new Set());
  const [rowErrors, setRowErrors] = useState({});
  const checkTimers = useRef({});
  const toast = useToast();

  // Debounced/blur duplicate preflight against the backend (source of truth).
  async function checkPlate(i, plate) {
    const p = (plate || '').trim();
    if (!p) { setWarnings((w) => { const n = { ...w }; delete n[i]; return n; }); return; }
    try {
      const res = await api.get('/school/vehicles/check-plate', { params: { plate_no: p } });
      setWarnings((w) => ({ ...w, [i]: res.data.data }));
    } catch {
      setWarnings((w) => { const n = { ...w }; delete n[i]; return n; }); // invalid/incomplete → handled on save
    }
  }

  // Phase 7.11.4 — render denied state for teacher AFTER all hooks are mounted.
  if (isGradeTeacher(user)) return <TeacherDeniedCard />;

  function addRow() {
    if (rows.length >= 10) { toast.error('สูงสุด 10 คันต่อครั้ง'); return; }
    setRows([...rows, { ...EMPTY_ROW }]);
  }
  function removeRow(i) {
    setRows(rows.filter((_, idx) => idx !== i));
    // Per-row state is keyed by array index, so removing a row must shift every
    // entry after it down by one (and drop the removed row's), or the restore
    // prompt / "ส่งคำขอแล้ว" confirmation / error would attach to the wrong row.
    const shift = (m) => {
      const out = {};
      for (const k of Object.keys(m)) { const n = Number(k); if (n < i) out[n] = m[k]; else if (n > i) out[n - 1] = m[k]; }
      return out;
    };
    setWarnings(shift); setRestorePrompt(shift); setRowErrors(shift);
    setRequestedRestore((s) => { const out = new Set(); for (const n of s) { if (n < i) out.add(n); else if (n > i) out.add(n - 1); } return out; });
  }

  function updateRow(i, field, value) {
    setRows((prev) => {
      const next = prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r));
      if (PLATE_FIELDS.includes(field)) {
        // Rebuild the canonical plate from the 3 parts and (debounced) preflight
        // only when all three are present (buildPlateNo returns '' otherwise).
        const plate = rowPlate(next[i]);
        clearTimeout(checkTimers.current[i]);
        checkTimers.current[i] = setTimeout(() => checkPlate(i, plate), 400);
      }
      return next;
    });
  }

  async function searchExisting() {
    if (!searchPlate.trim()) return;
    try {
      const res = await api.get(`/school/vehicles`);
      const found = res.data.data.filter((v) => v.plate_no.toLowerCase().includes(searchPlate.toLowerCase()));
      setExistingVehicles(found);
    } catch { setExistingVehicles([]); }
  }

  function selectExisting(v) {
    if (rows.length >= 10) { toast.error('สูงสุด 10 คันต่อครั้ง'); return; }
    const parts = parsePlateParts(v.plate_no) || { prefix: '', number: '', province: 'ลำปาง' };
    setRows([...rows, {
      plate_prefix: parts.prefix, plate_number: parts.number, plate_province: parts.province || 'ลำปาง',
      vehicle_type: v.vehicle_type || 'รถตู้', driver_name: v.driver_name || '', driver_phone: v.driver_phone || '', owner_name: v.owner_name || '', existing_id: v.id,
    }]);
    setExistingVehicles([]); setSearchPlate('');
  }

  async function handleSave() {
    // Carry each row's REAL index so per-row state (restorePrompt/rowErrors) is
    // keyed correctly even when two rows share the same built plate.
    const valid = rows.map((r, i) => ({ r, i })).filter(({ r }) => rowPlate(r));
    if (valid.length === 0) { toast.error('กรุณากรอกหมวดอักษร เลขทะเบียน และจังหวัดให้ครบถ้วน'); return; }

    // Block save while any row is flagged as a duplicate/similar plate. A
    // soft-deleted collision is also blocked, but the row shows a restore-request
    // action instead of a plain dead-end (see softDeletedConflict / requestRestore).
    const flagged = rows.some((r, i) => rowPlate(r) && warnings[i]?.status === 'DUPLICATE_OR_SIMILAR');
    if (flagged) {
      const hasSoftDeleted = rows.some((r, i) => rowPlate(r) && warnings[i]?.classification?.code === 'SOFT_DELETED_VEHICLE_EXISTS');
      toast.error(hasSoftDeleted
        ? 'มีรถที่ถูกปิดใช้งาน — กรุณาส่งคำขอกู้คืน หรือแก้ไขทะเบียนก่อนบันทึก'
        : 'พบรถทะเบียนใกล้เคียงในระบบ กรุณาตรวจสอบก่อนบันทึก');
      return;
    }

    setSaving(true);
    setRestorePrompt({}); setRowErrors({});   // fresh attempt; keep requestedRestore
    let ok = 0, fail = 0;
    for (const { r: row, i: idx } of valid) {
      const plate = rowPlate(row);
      try {
        await api.post('/school/vehicles', {
          plate_prefix: row.plate_prefix.trim(),
          plate_number: row.plate_number.trim(),
          plate_province: row.plate_province,
          plate_no: plate, // backend rebuilds canonically from the structured parts
          vehicle_type: row.vehicle_type,
          driver_name: row.driver_name.trim(),
          driver_phone: row.driver_phone.trim(),
          owner_name: (row.owner_name || '').trim(),
        });
        ok++;
      } catch (err) {
        fail++;
        const e0 = err.response?.data?.errors?.[0];
        if (e0?.code === 'SOFT_DELETED_VEHICLE_EXISTS' && e0.vehicle_id && idx >= 0) {
          // Dead-end → offer the admin-approved restore request (10.13B-7), no auto-restore.
          setRestorePrompt((p) => ({ ...p, [idx]: { vehicle_id: e0.vehicle_id, existing_plate: e0.existing_plate || plate, plate } }));
        } else if (idx >= 0) {
          setRowErrors((p) => ({ ...p, [idx]: err.response?.data?.message || 'บันทึกไม่สำเร็จ' }));
        }
      }
    }
    if (ok > 0) toast.success(`บันทึกสำเร็จ ${ok} คัน${fail > 0 ? ` · มี ${fail} คันต้องตรวจสอบด้านล่าง` : ''}`);
    else if (fail > 0) toast.error(`ยังบันทึกไม่ได้ ${fail} คัน — ดูรายละเอียดด้านล่าง`);
    setSaving(false);
    if (ok > 0 && fail === 0) { setRows([{ ...EMPTY_ROW }]); setWarnings({}); setRestorePrompt({}); setRowErrors({}); }
  }

  // A soft-deleted-plate collision can surface two ways: the live check-plate
  // preflight (primary — the operator sees it while typing) OR the POST /vehicles
  // 409 catch (fallback — if they saved before the debounce). Derive the restore
  // target from the preflight classification so the prompt shows in both paths.
  function softDeletedConflict(i) {
    const c = warnings[i]?.classification;
    return c?.code === 'SOFT_DELETED_VEHICLE_EXISTS' && c.vehicle_id
      ? { vehicle_id: c.vehicle_id, existing_plate: c.display_plate }
      : null;
  }

  // Phase 10.13C — from a soft-deleted-plate collision, request a vehicle restore
  // (admin-approved, 10.13B-7). Never auto-restores; mirrors ImportPreviewModal.
  async function requestRestore(i, info) {
    if (!info) return;
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
    }
  }

  const completeCount = rows.filter((r) => rowPlate(r)).length;
  const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-1">เพิ่มรถรับส่ง</h1>
      <p className="text-sm text-gray-500 mb-4">เพิ่มได้สูงสุด 10 คันต่อครั้ง · เฉพาะโรงเรียนของตนเอง</p>

      {/* Search existing vehicle */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <p className="text-sm font-medium text-gray-600 mb-2">ค้นหารถที่มีอยู่แล้วในระบบ</p>
        <div className="flex gap-2">
          <input type="text" value={searchPlate} onChange={(e) => setSearchPlate(e.target.value)}
            placeholder="พิมพ์ทะเบียนรถ…" className={`flex-1 ${inputCls}`} />
          <button onClick={searchExisting}
            className="bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm px-4 py-2 rounded-lg border border-blue-200 transition">ค้นหา</button>
        </div>
        {existingVehicles.length > 0 && (
          <div className="mt-2 space-y-1">
            {existingVehicles.map((v) => (
              <button key={v.id} onClick={() => selectExisting(v)}
                className="w-full text-left text-sm px-3 py-2 bg-gray-50 hover:bg-blue-50 rounded-lg border border-gray-100 transition">
                {v.plate_no} — {v.driver_name || 'ไม่ระบุคนขับ'} ({v.student_count} คน)
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Vehicle rows */}
      <div className="space-y-3 mb-4">
        {rows.map((r, i) => {
          const plate = rowPlate(r);
          const restoreInfo = restorePrompt[i] || softDeletedConflict(i);
          return (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">คันที่ {i + 1}</span>
                {rows.length > 1 && (
                  <button onClick={() => removeRow(i)} className="text-xs text-red-500 hover:text-red-700">ลบ</button>
                )}
              </div>

              {/* Structured plate input */}
              <label className="block text-xs text-gray-500 mb-0.5">ทะเบียนรถ *</label>
              <div className="grid grid-cols-3 gap-2">
                <input type="text" value={r.plate_prefix} maxLength={4}
                  onChange={(e) => updateRow(i, 'plate_prefix', e.target.value)}
                  placeholder="หมวดอักษร เช่น นข" className={inputCls} aria-label="หมวดอักษร" />
                <input type="text" inputMode="numeric" value={r.plate_number} maxLength={4}
                  onChange={(e) => updateRow(i, 'plate_number', e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="เลขทะเบียน เช่น 4337" className={inputCls} aria-label="เลขทะเบียน" />
                <select value={r.plate_province} onChange={(e) => updateRow(i, 'plate_province', e.target.value)}
                  className={inputCls} aria-label="จังหวัด">
                  {THAI_PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              {plate
                ? <p className="mt-1 text-xs text-gray-500">ทะเบียนที่จะบันทึก: <span className="font-medium text-gray-700">{plate}</span> · ชื่อเข้าระบบ: <span className="font-mono text-gray-600">{normalizedLoginPlate(plate)}</span></p>
                : <p className="mt-1 text-xs text-gray-400">กรอกหมวดอักษร เลขทะเบียน และจังหวัดให้ครบถ้วน</p>}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">ประเภทรถ</label>
                  <select value={r.vehicle_type} onChange={(e) => updateRow(i, 'vehicle_type', e.target.value)} className={inputCls}>
                    <option value="รถตู้">รถตู้</option>
                    <option value="รถสองแถว">รถสองแถว</option>
                    <option value="รถบัส">รถบัส</option>
                    <option value="อื่นๆ">อื่นๆ</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">ชื่อคนขับ</label>
                  <input type="text" value={r.driver_name} onChange={(e) => updateRow(i, 'driver_name', e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">เบอร์โทรคนขับ</label>
                  <input type="text" value={r.driver_phone} onChange={(e) => updateRow(i, 'driver_phone', e.target.value)} className={inputCls} />
                </div>
              </div>

              <div className="mt-3">
                <label className="block text-xs text-gray-500 mb-0.5">ชื่อผู้ครอบครองรถ (เจ้าของรถ)</label>
                <input type="text" value={r.owner_name} maxLength={100} onChange={(e) => updateRow(i, 'owner_name', e.target.value)} className={inputCls} placeholder="เว้นว่างได้ หากเป็นคนเดียวกับคนขับ" />
              </div>

              {restoreInfo ? (
                <div className="mt-2 text-xs bg-blue-50 border border-blue-300 text-blue-800 rounded-lg px-3 py-2">
                  <div className="font-medium">รถทะเบียนนี้ถูกปิดใช้งานอยู่ ({restoreInfo.existing_plate})</div>
                  <div className="mt-0.5">ต้องการใช้งานต่อ ส่งคำขอให้ผู้ดูแลระบบกู้คืนรถคันนี้ (ไม่กู้คืนทันที)</div>
                  {requestedRestore.has(i) ? (
                    <div className="mt-1.5 font-medium text-emerald-700">✓ ส่งคำขอแล้ว · รอผู้ดูแลระบบอนุมัติ</div>
                  ) : (
                    <button type="button" onClick={() => requestRestore(i, restoreInfo)}
                      className="mt-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition">
                      ส่งคำขอกู้คืนรถนี้
                    </button>
                  )}
                </div>
              ) : warnings[i]?.status === 'DUPLICATE_OR_SIMILAR' ? (
                <div className="mt-2 text-xs bg-amber-50 border border-amber-300 text-amber-800 rounded-lg px-3 py-2">
                  ⚠️ พบรถทะเบียนใกล้เคียงในระบบแล้ว กรุณาตรวจสอบก่อนบันทึก
                  <div className="mt-0.5 font-medium">มีอยู่แล้ว: {warnings[i].candidates.map((c) => c.plate_no).join(', ')}</div>
                </div>
              ) : warnings[i]?.status === 'CLEAR' && plate && !rowErrors[i] ? (
                <div className="mt-2 text-xs text-green-600">ยังไม่พบทะเบียนนี้ในระบบ</div>
              ) : null}
              {rowErrors[i] && !restoreInfo && (
                <div className="mt-2 text-xs bg-red-50 border border-red-300 text-red-700 rounded-lg px-3 py-2">{rowErrors[i]}</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        {rows.length < 10 && (
          <button onClick={addRow}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium px-5 py-2 rounded-lg transition">
            + เพิ่มอีกคัน
          </button>
        )}
        <button onClick={handleSave} disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition">
          {saving ? 'กำลังบันทึก…' : `บันทึก ${completeCount} คัน`}
        </button>
      </div>
    </div>
  );
}
