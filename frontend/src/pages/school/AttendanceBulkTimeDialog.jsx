import { useMemo, useState } from 'react';
import api from '../../api/axios';
import { ConfirmDialog, FormField } from '../../components/ui';
import { useToast } from '../../components/Toast';

export function timeEntries(rooms, roomKey = '') {
  return rooms.filter(room => !roomKey || room.key === roomKey).flatMap(room => room.students)
    .filter(st => !st.on_leave && ((st.log_id && st.checked_at) || (st.self_travel && st.self_id && st.self_recorded_at)))
    .map(st => ({ kind: st.self_travel ? 'self' : 'bus', id: Number(st.self_travel ? st.self_id : st.log_id),
      expected_at: st.self_travel ? st.self_recorded_at : st.checked_at }));
}

export default function AttendanceBulkTimeDialog({ rooms, grade, session, onClose, onSaved }) {
  const toast = useToast();
  const [roomKey, setRoomKey] = useState('');
  const [time, setTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const entries = useMemo(() => timeEntries(rooms, roomKey), [rooms, roomKey]);
  const date = new Date().toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' });
  async function save() {
    if (saving || !entries.length || !time) return;
    setSaving(true); setError('');
    try {
      const { data } = await api.patch('/school/attendance-times', { session, time, entries });
      toast.success(`แก้เวลาแล้ว ${data.data.updated} รายการ`);
      await onSaved(); onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'ยังยืนยันผลไม่ได้ กรุณาปิดหน้าต่างและโหลดรายชื่อใหม่ก่อนลองอีกครั้ง');
    } finally { setSaving(false); }
  }
  return <ConfirmDialog open tone="brand" title="ปรับเวลาเช็กชื่อทั้งสายชั้น"
    description={`${date} · ${grade} · รอบ${session === 'morning' ? 'เช้า' : 'กลับ'} แก้เฉพาะเวลารายการที่บันทึกแล้ว ไม่เปลี่ยนสถานะลา และไม่สร้างรายการเช็กชื่อใหม่ ระบบเก็บเวลาเดิมและผู้แก้โดยอัตโนมัติ`}
    confirmLabel={`บันทึกเวลา ${entries.length} รายการ`} confirmDisabled={!time || !entries.length || entries.length > 1000 || !!error}
    loading={saving} onConfirm={save} onCancel={() => { if (!saving) onClose(); }}>
    <div className="space-y-4">
      <FormField label="ห้องที่ต้องการปรับเวลา" disabled={saving}>
        {props => <select {...props} value={roomKey} onChange={e => setRoomKey(e.target.value)}
          className="focus-ring w-full min-h-[44px] px-3 rounded-lg border border-surface-border bg-surface-raised text-base text-ink">
          <option value="">ทุกห้องในสายชั้น</option>
          {rooms.map(room => <option key={room.key} value={room.key}>{room.classroom ? `ห้อง ${room.classroom}` : 'ไม่ระบุห้อง'}</option>)}
        </select>}
      </FormField>
      <FormField label="เวลาใหม่ตามที่เกิดขึ้นจริง" type="time" required value={time} onChange={setTime} disabled={saving} />
      <p className="text-sm text-ink-muted" aria-live="polite">จะปรับ {entries.length} รายการ ไม่รวมผู้ลาและผู้ที่ยังไม่ได้บันทึก · หากเวลาเดิมถูกต้องอยู่แล้วให้คงไว้</p>
      {entries.length > 1000 && <p role="alert" className="text-sm text-danger-ink">กรุณาเลือกทีละห้อง ไม่เกิน 1,000 รายการต่อครั้ง</p>}
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
    </div>
  </ConfirmDialog>;
}
