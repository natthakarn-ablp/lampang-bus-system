import { useState } from 'react';
import { Bus, ChevronDown } from 'lucide-react';
import api from '../api/axios';
import { VehicleSafetySection } from './VehicleSafety';
import { AppCard, StatusBadge, DataTable } from './ui';

/**
 * VehicleRosterCard — one vehicle, with an expandable pupil roster.
 *
 * The province and affiliation vehicle lists carried this card as two separate
 * near-identical copies (same layout, same expand-on-demand fetch, same inline
 * student table), which meant a fix to one silently left the other behind.
 * `studentsPath` is the only thing that differed.
 *
 * `showContactPhones` controls whether staff phone numbers are rendered.
 * Province scope does not currently show them; affiliation scope does. Kept as
 * a prop rather than hardcoded so the choice stays visible at the call site.
 */
export default function VehicleRosterCard({
  vehicle: v,
  studentsPath,
  showContactPhones = false,
}) {
  const [open, setOpen] = useState(false);
  const [students, setStudents] = useState(null);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (students || failed) return;
    try {
      const res = await api.get(`${studentsPath}?vehicle_id=${v.id}&per_page=100`);
      setStudents(Array.isArray(res.data.data) ? res.data.data : []);
    } catch {
      // The roster failing must not take the vehicle card with it.
      setFailed(true);
    }
  }

  const person = (name, phone) => (
    <>
      <dd className="text-ink">{name || '-'}</dd>
      {showContactPhones && phone && (
        <dd className="text-caption text-ink-muted tabular-nums">{phone}</dd>
      )}
    </>
  );

  return (
    <AppCard padding="md">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-ink">{v.plate_no}</h2>
          <p className="text-caption text-ink-muted">{v.vehicle_type || 'ไม่ระบุประเภท'}</p>
          {v.school_names && (
            <p className="text-caption text-brand-700 mt-0.5">{v.school_names}</p>
          )}
        </div>
        <StatusBadge variant="brand" size="lg">
          <span className="tabular-nums">{v.student_count ?? 0}</span> คน
        </StatusBadge>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-caption text-ink-muted mb-0.5">คนขับ</dt>
          {person(v.driver_name, v.driver_phone)}
        </div>
        <div>
          <dt className="text-caption text-ink-muted mb-0.5">ผู้ดูแลรถ</dt>
          {person(v.attendant_name, v.attendant_phone)}
        </div>
        <div>
          <dt className="text-caption text-ink-muted mb-0.5">เจ้าของรถ</dt>
          {person(v.owner_name, v.owner_phone)}
        </div>
      </dl>

      <VehicleSafetySection vehicle={v} />

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={`roster-${v.id}`}
        className="focus-ring mt-3 inline-flex items-center gap-1.5 min-h-[44px] px-2 -ml-2 rounded-lg text-sm font-medium text-brand-700 hover:bg-brand-50 active:bg-brand-100 transition"
      >
        <ChevronDown
          className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={2.2}
          aria-hidden="true"
        />
        {open ? 'ซ่อนรายชื่อนักเรียน' : 'แสดงรายชื่อนักเรียน'}
      </button>

      {open && (
        <div id={`roster-${v.id}`} className="mt-2 border-t border-surface-border pt-3">
          {/* TODO: ตรวจสอบกับผู้เชี่ยวชาญ — the roster pairs a pupil's name with
              their guardian's name and phone number. The backend already
              authorises this for both scopes and existing workflows may depend
              on it, so it is rendered as before; whether every scope needs the
              guardian phone column is a data-minimisation decision for the data
              controller, not one to make silently in the UI. */}
          <DataTable
            caption={`รายชื่อนักเรียนในรถ ${v.plate_no}`}
            rows={students || []}
            rowKey={s => s.id}
            error={failed ? 'ไม่สามารถโหลดรายชื่อนักเรียนได้' : null}
            onRetry={failed ? () => { setFailed(false); setStudents(null); setOpen(false); } : undefined}
            columns={[
              { key: 'name', header: 'ชื่อ-นามสกุล', primary: true,
                cell: s => `${s.prefix || ''}${s.first_name} ${s.last_name}` },
              { key: 'grade', header: 'ชั้น/ห้อง', secondary: true,
                cell: s => (s.grade && s.classroom ? `${s.grade}/${s.classroom}` : s.grade || '-') },
              { key: 'school', header: 'โรงเรียน', cell: s => s.school_name || '-' },
              { key: 'parent', header: 'ผู้ปกครอง', cell: s => s.parent_name || '-' },
              { key: 'phone', header: 'เบอร์โทร', cell: s => s.parent_phone || '-' },
            ]}
            empty={{
              icon: Bus,
              title: students ? 'ไม่มีนักเรียนในรถคันนี้' : 'กำลังโหลด…',
            }}
          />
        </div>
      )}
    </AppCard>
  );
}
