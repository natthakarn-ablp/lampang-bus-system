import { useState } from 'react';
import api from '../../api/axios';
import { ConfirmDialog, FormField } from '../../components/ui';
import { useToast } from '../../components/Toast';

export function bangkokTime(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export default function AttendanceTimeDialog({ student, onClose, onSaved }) {
  const toast = useToast();
  const originalTime = bangkokTime(student.self_travel ? student.self_recorded_at : student.checked_at);
  const [time, setTime] = useState(originalTime);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving || !time || time === originalTime) return;
    setSaving(true);
    try {
      const path = student.self_travel
        ? `/school/self-travel/${student.self_id}/time`
        : `/school/teacher-check/${student.log_id}/time`;
      await api.patch(path, { time });
      toast.success('แก้เวลาแล้ว');
      await onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'แก้เวลาไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return <ConfirmDialog open tone="brand" title="แก้เวลายืนยันรายคน"
    itemName={student.name}
    description="เลือกเวลาที่เกิดเหตุการณ์จริงของวันนี้ ระบบเก็บเวลาเดิม เวลาใหม่ และผู้แก้ไว้ในประวัติอัตโนมัติ"
    confirmLabel="บันทึกเวลา" loading={saving} confirmDisabled={!time || time === originalTime}
    onConfirm={save} onCancel={() => { if (!saving) onClose(); }}>
    <FormField label="เวลาใหม่" type="time" required value={time} onChange={setTime} />
  </ConfirmDialog>;
}
