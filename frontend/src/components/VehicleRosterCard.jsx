import { useState } from 'react';
import { Bus, ChevronDown, User } from 'lucide-react';
import api from '../api/axios';
import { VehicleSafetySection } from './VehicleSafety';
import { AppCard, StatusBadge, DataTable } from './ui';

/**
 * VehicleRosterCard — one vehicle, with an expandable pupil roster.
 *
 * The province, affiliation and school vehicle lists each carried their own
 * copy of this card: same layout, same expand-on-demand fetch, same inline
 * student table. Only the students endpoint and a few scope-specific extras
 * differed, so a fix to one silently left the others behind.
 *
 * The scope differences are props, so each call site states its own choice:
 *   showContactPhones  staff phone numbers (affiliation shows them, province does not)
 *   phoneLinks         render the driver's number as a tel: link (school, on mobile)
 *   showDriverPhoto    the school list shows the driver's photo for recognition
 *   rosterColumns      which roster columns this scope shows
 *   actions            extra controls beside the pupil count (school: edit vehicle)
 */
const DEFAULT_ROSTER = ['name', 'grade', 'school', 'parent', 'phone'];

export default function VehicleRosterCard({
  vehicle: v,
  studentsPath,
  showContactPhones = false,
  showDriverPhoto = false,
  phoneLinks = false,
  rosterColumns = DEFAULT_ROSTER,
  actions,
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

  const phone = (num) => {
    if (!num || !showContactPhones) return null;
    return phoneLinks
      ? (
        <dd>
          <a href={`tel:${num}`} className="focus-ring rounded text-caption text-brand-700 hover:underline tabular-nums">
            {num}
          </a>
        </dd>
      )
      : <dd className="text-caption text-ink-muted tabular-nums">{num}</dd>;
  };

  const ALL_COLUMNS = {
    name:   { key: 'name', header: 'ชื่อ-นามสกุล', primary: true,
              cell: s => `${s.prefix || ''}${s.first_name} ${s.last_name}` },
    grade:  { key: 'grade', header: 'ชั้น/ห้อง', secondary: true,
              cell: s => (s.grade && s.classroom ? `${s.grade}/${s.classroom}` : s.grade || '-') },
    school: { key: 'school', header: 'โรงเรียน', cell: s => s.school_name || '-' },
    parent: { key: 'parent', header: 'ผู้ปกครอง', cell: s => s.parent_name || '-' },
    phone:  { key: 'phone', header: 'เบอร์โทร', cell: s => s.parent_phone || '-' },
  };

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
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge variant="brand" size="lg">
            <span className="tabular-nums">{v.student_count ?? 0}</span> คน
          </StatusBadge>
          {actions}
        </div>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div className={showDriverPhoto ? 'flex items-start gap-2' : undefined}>
          {showDriverPhoto && (
            v.driver_photo
              ? <img src={`/uploads/drivers/${v.driver_photo}`} alt="" aria-hidden="true"
                     className="w-10 h-10 rounded-full object-cover shrink-0 border border-surface-border" />
              : <span className="w-10 h-10 rounded-full bg-surface border border-surface-border inline-flex items-center justify-center shrink-0">
                  <User className="w-5 h-5 text-ink-muted" strokeWidth={2} aria-hidden="true" />
                </span>
          )}
          <div className="min-w-0">
            <dt className="text-caption text-ink-muted mb-0.5">คนขับ</dt>
            <dd className="text-ink font-medium">{v.driver_name || '-'}</dd>
            {phone(v.driver_phone)}
          </div>
        </div>
        <div>
          <dt className="text-caption text-ink-muted mb-0.5">ผู้ดูแลรถ</dt>
          <dd className="text-ink">{v.attendant_name || '-'}</dd>
          {phone(v.attendant_phone)}
        </div>
        <div>
          <dt className="text-caption text-ink-muted mb-0.5">เจ้าของรถ</dt>
          <dd className="text-ink">{v.owner_name || '-'}</dd>
          {phone(v.owner_phone)}
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
              authorises this for every scope that renders it and existing
              workflows may depend on it, so it is shown as before; whether each
              scope needs the guardian phone column is a data-minimisation
              decision for the data controller, not one to make silently here. */}
          <DataTable
            caption={`รายชื่อนักเรียนในรถ ${v.plate_no}`}
            rows={students || []}
            rowKey={s => s.id}
            error={failed ? 'ไม่สามารถโหลดรายชื่อนักเรียนได้' : null}
            onRetry={failed ? () => { setFailed(false); setStudents(null); setOpen(false); } : undefined}
            columns={rosterColumns.map(k => ALL_COLUMNS[k]).filter(Boolean)}
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
