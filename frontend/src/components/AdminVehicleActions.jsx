import { useState, useEffect, useRef } from 'react';
import { Trash2, GitMerge } from 'lucide-react';
import api from '../api/axios';
import { FormField, Modal, TableAction } from './ui';
import { useToast } from './Toast';

/**
 * Admin-only vehicle delete and duplicate merge (2026-11-13). Both endpoints
 * already existed admin-only; this is the screen for them.
 *
 *   ลบรถ       DELETE /admin/vehicles/:id { reason, force? }
 *   รวมรถซ้ำ    POST   /admin/vehicles/:id/merge { into_vehicle_id, reason }
 *
 * Each dialog first reads GET /admin/vehicles/:id/impact (read-only) so the
 * admin sees what will be detached or moved before confirming. A reason is
 * always required. Deleting a vehicle that still has pupils or an active
 * driver needs the explicit "ลบทั้งที่ยังใช้งานอยู่" tick (sent as force).
 */

const TABLE_LABEL = {
  students: 'นักเรียน',
  vehicle_attendants: 'ผู้ดูแลประจำรถ',
  checkin_logs: 'บันทึกขึ้น–ลงรถ',
  vehicle_inspections: 'ผลตรวจสภาพรถ',
  emergency_logs: 'เหตุฉุกเฉิน',
  student_leaves: 'การลาของนักเรียน',
  roster_change_requests: 'คำขอเปลี่ยนรายชื่อ',
  pickup_points: 'จุดรับส่ง',
  vehicle_location_history: 'ประวัติตำแหน่ง GPS',
  geofences: 'รั้วพิกัด (geofence)',
  geofence_events: 'เหตุการณ์เข้า–ออกรั้วพิกัด',
  route_deviations: 'การออกนอกเส้นทาง',
  vehicle_inspection_applications: 'คำขอตรวจสภาพรถ',
  daily_status: 'สถานะรายวัน',
  vehicle_requests: 'คำขอเพิ่มรถ',
  driver_vehicle_assignments: 'การมอบหมายคนขับ',
  vehicle_latest_locations: 'ตำแหน่งล่าสุด',
  route_baselines: 'เส้นทางอ้างอิง',
  eta_predictions: 'การคาดเวลาถึง',
  vehicle_operating_shifts: 'รอบการเดินรถ',
};

function CountList({ counts }) {
  const entries = Object.entries(counts || {});
  if (!entries.length) return <p className="text-sm text-ink-muted">ไม่มี</p>;
  return (
    <ul className="text-sm text-ink list-disc pl-5 space-y-0.5">
      {entries.map(([table, n]) => (
        <li key={table}>{TABLE_LABEL[table] || table}: {Number(n).toLocaleString('th-TH')} รายการ</li>
      ))}
    </ul>
  );
}

const btn = 'focus-ring text-base font-medium px-4 min-h-[44px] rounded-lg border border-surface-border text-ink hover:bg-surface transition disabled:opacity-50';
const danger = 'focus-ring text-base font-semibold px-4 min-h-[44px] rounded-lg bg-danger-ink hover:bg-danger-ink/90 text-white transition disabled:opacity-50';

export default function AdminVehicleActions({ vehicle, onChanged }) {
  const toast = useToast();
  const [mode, setMode] = useState(null); // 'delete' | 'merge'
  const [impact, setImpact] = useState(null);
  const [impactError, setImpactError] = useState('');
  const [reason, setReason] = useState('');
  const [force, setForce] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // merge target search
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [target, setTarget] = useState(null);
  const lock = useRef(false);

  function open(next) {
    setMode(next); setImpact(null); setImpactError(''); setReason(''); setForce(false);
    setError(''); setQuery(''); setMatches([]); setTarget(null);
    api.get(`/admin/vehicles/${encodeURIComponent(vehicle.id)}/impact`)
      .then((res) => setImpact(res.data?.data || null))
      .catch((err) => setImpactError(err.response?.data?.message || 'โหลดข้อมูลผลกระทบไม่สำเร็จ'));
  }
  function close() { if (!lock.current) setMode(null); }

  // Debounced plate search for the merge target (same list the page uses).
  useEffect(() => {
    if (mode !== 'merge' || query.trim().length < 2) { setMatches([]); return undefined; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      const params = new URLSearchParams({ page: '1', per_page: '10', search: query.trim() });
      api.get(`/transport/vehicles?${params}`, { signal: ctrl.signal })
        .then((res) => {
          const rows = Array.isArray(res.data?.data) ? res.data.data : [];
          setMatches(rows.filter((r) => String(r.id) !== String(vehicle.id)));
        })
        .catch(() => { if (!ctrl.signal.aborted) setMatches([]); });
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [mode, query, vehicle.id]);

  const inUse = Boolean(impact && (impact.active_students > 0 || impact.active_assignments > 0));
  const canSubmit = !saving && impact && reason.trim()
    && (mode === 'delete' ? (!inUse || force) : Boolean(target));

  async function submit() {
    if (!canSubmit || lock.current) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const url = `/admin/vehicles/${encodeURIComponent(vehicle.id)}`;
      const res = mode === 'delete'
        ? await api.delete(url, { data: { reason: reason.trim(), ...(inUse ? { force: true } : {}) } })
        : await api.post(`${url}/merge`, { into_vehicle_id: target.id, reason: reason.trim() });
      toast.success(res.data?.message || 'บันทึกแล้ว');
      lock.current = false;
      setMode(null);
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.message || 'ทำรายการไม่สำเร็จ');
    } finally { lock.current = false; setSaving(false); }
  }

  return (
    <>
      <TableAction tone="danger" onClick={() => open('merge')} aria-label={`รวมรถซ้ำ ${vehicle.plate_no}`}>
        <GitMerge className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden="true" />
        รวมรถซ้ำ
      </TableAction>
      <TableAction tone="danger" onClick={() => open('delete')} aria-label={`ลบรถ ${vehicle.plate_no}`}>
        <Trash2 className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden="true" />
        ลบรถ
      </TableAction>

      {mode && (
        <Modal
          open
          title={mode === 'delete' ? `ลบรถ ${vehicle.plate_no}` : `รวมรถซ้ำ: ${vehicle.plate_no}`}
          size="sm"
          dismissible={!saving}
          onClose={close}
          footer={
            <>
              <button type="button" onClick={close} disabled={saving} className={btn}>ยกเลิก</button>
              <button type="submit" form="admin-vehicle-action-form" disabled={!canSubmit} className={danger}>
                {saving ? 'กำลังบันทึก…' : mode === 'delete' ? 'ลบรถ' : 'รวมเข้ากับรถปลายทาง'}
              </button>
            </>
          }
        >
          <form id="admin-vehicle-action-form" onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-3">
            {impactError && <p role="alert" className="text-sm text-danger-ink">{impactError}</p>}
            {!impact && !impactError && <p className="text-sm text-ink-muted">กำลังตรวจข้อมูลที่ผูกกับรถคันนี้…</p>}

            {impact && mode === 'delete' && (
              <>
                <p className="text-sm text-ink">
                  นักเรียนที่ใช้รถคันนี้: <strong>{impact.active_students}</strong> คน ·
                  คนขับที่มอบหมายอยู่: <strong>{impact.active_assignments ? (impact.driver_name || 'มี') : 'ไม่มี'}</strong>
                </p>
                <p className="text-sm text-ink-muted">
                  ลบแบบซ่อน (soft delete) ประวัติเดิมยังอยู่ ทะเบียนนี้เพิ่มใหม่ได้ภายหลัง
                  ถ้าเป็นรถซ้ำของอีกคันให้ใช้ "รวมรถซ้ำ" แทน เพื่อย้ายนักเรียนและประวัติไปด้วย
                </p>
                {inUse && (
                  <label className="flex items-start gap-2 text-sm text-warn-ink">
                    <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)}
                      className="focus-ring mt-1 h-5 w-5" />
                    <span>ลบทั้งที่ยังใช้งานอยู่ — นักเรียน {impact.active_students} คนจะไม่มีรถ และการมอบหมายคนขับจะสิ้นสุดทันที</span>
                  </label>
                )}
              </>
            )}

            {impact && mode === 'merge' && (
              <>
                <p className="text-sm text-ink-muted">
                  รถคันนี้ ({vehicle.plate_no}) จะถูกลบ และข้อมูลด้านล่างจะย้ายไปที่รถปลายทาง ย้อนกลับไม่ได้
                </p>
                <div>
                  <p className="text-sm font-medium text-ink mb-1">ย้ายไปรถปลายทาง</p>
                  <CountList counts={impact.moves} />
                </div>
                {Object.keys(impact.cleared || {}).length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-ink mb-1">ลบทิ้ง (ระบบคำนวณใหม่เอง)</p>
                    <CountList counts={impact.cleared} />
                  </div>
                )}
                <p className="text-sm text-warn-ink">
                  ถ้ารถปลายทางมีคนขับที่มอบหมายอยู่แล้ว การมอบหมายคนขับของคันนี้จะสิ้นสุด · บัญชีคนขับ (ชื่อผู้ใช้ = ทะเบียนเดิม) ไม่ถูกย้าย
                  ตรวจที่หน้าจัดการผู้ใช้หลังรวม
                </p>
                <FormField label="ค้นทะเบียนรถปลายทาง" value={query} onChange={(v) => { setQuery(v); setTarget(null); }}
                  placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร" helper="เลือกรถคันที่ถูกต้องที่จะเก็บไว้" />
                {matches.length > 0 && (
                  <fieldset className="space-y-1">
                    <legend className="sr-only">เลือกรถปลายทาง</legend>
                    {matches.map((m) => (
                      <label key={m.id} className="flex items-center gap-2 min-h-[44px] rounded-lg border border-surface-border px-3 text-base text-ink">
                        <input type="radio" name="merge-target" checked={target?.id === m.id}
                          onChange={() => setTarget(m)} className="focus-ring h-5 w-5" />
                        <span>{m.plate_no}{m.driver_name ? ` · ${m.driver_name}` : ''}</span>
                      </label>
                    ))}
                  </fieldset>
                )}
                {query.trim().length >= 2 && matches.length === 0 && (
                  <p className="text-sm text-ink-muted">ไม่พบรถคันอื่นที่ตรงกับคำค้น</p>
                )}
                {target && <p className="text-sm text-ink">รวม <strong>{vehicle.plate_no}</strong> เข้ากับ <strong>{target.plate_no}</strong></p>}
              </>
            )}

            <FormField label="เหตุผล" required value={reason} onChange={setReason} maxLength={500}
              placeholder={mode === 'delete' ? 'เช่น รถเลิกให้บริการ' : 'เช่น เพิ่มรถซ้ำสองครั้ง'} />
            {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
          </form>
        </Modal>
      )}
    </>
  );
}
