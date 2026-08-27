import { useMemo, useState } from 'react';
import PickupCoordPicker from './PickupCoordPicker';
import { AlertBanner, FilterBar, FormField } from './ui';
import { classroomLabel } from '../utils/student';

/**
 * PickupPointFields — the shared body of the driver and school pickup-point
 * editors.
 *
 * Both pages let their user place a point on the map, name it, pick which
 * session(s) it serves, choose which pupils board there, and add a note. They
 * carried two copies of that form, which had already drifted: the school one
 * had 40px buttons and a stacked mobile footer, the driver one did not, and
 * only one of them disabled Save while required data was missing.
 *
 * The school editor additionally picks a vehicle first, since a school owns
 * several. That is passed in as `leadingFields` rather than baked in, so the
 * difference stays visible at the call site.
 *
 * The admin override editor has the same fields but assigns pupils through a
 * separate dialog, so it omits `onToggleStudent` and the checklist disappears.
 * The block is the shared part; who may board is the part that differs.
 *
 * The parent owns `form` and `selectedIds` because it submits them; this owns
 * the presentation, the client-side pupil filter, and the select-all logic.
 * No API call happens here — the payload shape and endpoints are unchanged.
 */
const EMPTY_SELECTION = new Set();

const SESSIONS = [
  ['morning', 'รอบเช้า'],
  ['evening', 'รอบเย็น'],
  ['both', 'ทั้งสองรอบ'],
];

export default function PickupPointFields({
  form,
  onChange,
  sessionLabels = Object.fromEntries(SESSIONS),
  leadingFields,
  students = [],
  studentsLoading = false,
  studentsError = null,
  studentsEmptyText = 'ไม่มีนักเรียนที่เพิ่มได้ในรอบนี้',
  // Defaulted so the derived select-all state is safe for callers that
  // never show the checklist.
  selectedIds = EMPTY_SELECTION,
  onToggleStudent,
  onSetSelected,
  trailingFields,
  errors = [],
}) {
  // Callers that assign pupils elsewhere pass no toggle handler.
  const showStudents = typeof onToggleStudent === 'function';
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return students;
    return students.filter(s =>
      `${s.prefix || ''}${s.first_name} ${s.last_name} ${classroomLabel(s) || ''}`.toLowerCase().includes(q));
  }, [students, filter]);

  const allVisibleSelected = visible.length > 0 && visible.every(s => selectedIds.has(s.id));

  function toggleAllVisible() {
    const next = new Set(selectedIds);
    if (allVisibleSelected) visible.forEach(s => next.delete(s.id));
    else visible.forEach(s => next.add(s.id));
    onSetSelected(next);
  }

  const coords = (form.latitude !== '' && form.longitude !== '')
    ? [Number(form.latitude), Number(form.longitude)]
    : null;

  return (
    <div className="space-y-3">
      {leadingFields}

      <FormField
        label="ป้ายชื่อจุด"
        required
        maxLength={100}
        value={form.label}
        onChange={v => onChange('label', v)}
        placeholder="เช่น หน้าโรงเรียน, ปาก ซ.5"
      />

      <div className="grid grid-cols-2 gap-3">
        <FormField label="Latitude" required helper="-90 ถึง 90">
          {ctl => (
            <input
              {...ctl}
              type="number" step="any" required min={-90} max={90}
              value={form.latitude}
              onChange={e => onChange('latitude', e.target.value)}
              className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink tabular-nums transition"
            />
          )}
        </FormField>
        <FormField label="Longitude" required helper="-180 ถึง 180">
          {ctl => (
            <input
              {...ctl}
              type="number" step="any" required min={-180} max={180}
              value={form.longitude}
              onChange={e => onChange('longitude', e.target.value)}
              className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink tabular-nums transition"
            />
          )}
        </FormField>
      </div>

      <p className="text-caption text-ink-muted">คลิกบนแผนที่เพื่อกำหนดพิกัด</p>
      <PickupCoordPicker
        value={coords}
        onChange={([lat, lng]) => {
          onChange('latitude', lat.toFixed(6));
          onChange('longitude', lng.toFixed(6));
        }}
      />

      {/* Session is a single choice from a fixed set, so a radiogroup rather
          than a row of styled buttons. */}
      <div>
        <p id="pickup-session-label" className="block text-sm font-medium text-ink mb-1">รอบ</p>
        <div role="radiogroup" aria-labelledby="pickup-session-label" className="flex flex-wrap gap-1.5">
          {SESSIONS.map(([value]) => {
            const on = form.session === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange('session', value)}
                className={`focus-ring inline-flex items-center px-3.5 min-h-[44px] rounded-full text-sm font-medium transition border ${
                  on
                    ? 'bg-navy-700 text-white border-navy-700'
                    : 'bg-surface-raised text-ink-muted border-surface-border hover:bg-surface hover:text-ink'
                }`}
              >
                {sessionLabels[value] || value}
              </button>
            );
          })}
        </div>
      </div>

      {/* Pupil checklist — only for the editors that assign pupils inline */}
      {showStudents && (
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-sm font-medium text-ink" id="pickup-students-label">
            เลือกนักเรียนที่ยังไม่มีจุดรับส่งในรอบนี้
            {students.length > 0 && (
              <span className="ml-1 text-ink-muted tabular-nums">({selectedIds.size}/{students.length})</span>
            )}
          </p>
          {visible.length > 0 && (
            <button
              type="button"
              onClick={toggleAllVisible}
              className="focus-ring shrink-0 text-sm text-brand-700 font-medium px-2 min-h-[44px] rounded-lg hover:bg-brand-50 transition"
            >
              {allVisibleSelected ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
            </button>
          )}
        </div>

        {studentsLoading ? (
          <p className="text-sm text-ink-muted py-3 text-center">กำลังโหลดรายชื่อ…</p>
        ) : studentsError ? (
          <AlertBanner variant="danger" title="โหลดรายชื่อไม่สำเร็จ">{studentsError}</AlertBanner>
        ) : students.length === 0 ? (
          <p className="text-sm text-ink-muted py-3 text-center">{studentsEmptyText}</p>
        ) : (
          <>
            <FilterBar
              className="mb-2"
              search={{
                value: filter,
                onChange: setFilter,
                label: 'กรองรายชื่อนักเรียน',
                placeholder: 'กรองตามชื่อ / ห้อง…',
              }}
            />
            <div
              role="group"
              aria-labelledby="pickup-students-label"
              className="border border-surface-border rounded-lg divide-y divide-surface-border max-h-56 overflow-y-auto"
            >
              {visible.map(s => {
                const cls = classroomLabel(s);
                return (
                  <label
                    key={s.id}
                    className="flex items-center gap-2 px-3 min-h-[44px] cursor-pointer hover:bg-surface transition"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => onToggleStudent(s.id)}
                      className="focus-ring w-5 h-5 rounded border-surface-border accent-brand-600"
                    />
                    <span className="flex-1 min-w-0 text-sm">
                      <span className="font-medium text-ink">{s.prefix || ''}{s.first_name} {s.last_name}</span>
                      {cls && <span className="text-caption text-ink-muted ml-2">· {cls}</span>}
                    </span>
                  </label>
                );
              })}
              {visible.length === 0 && filter && (
                <p className="text-caption text-ink-muted py-3 text-center">ไม่พบนักเรียนตามที่กรอง</p>
              )}
            </div>
          </>
        )}
      </div>
      )}

      <FormField
        label="หมายเหตุ"
        helper="ไม่บังคับ"
        maxLength={255}
        value={form.notes}
        onChange={v => onChange('notes', v)}
      />

      {trailingFields}

      {errors.length > 0 && (
        <AlertBanner variant="danger" title="บันทึกไม่สำเร็จ">
          <ul className="list-disc pl-4 text-caption">
            {errors.map((e, i) => <li key={i}>{e.field ? `${e.field}: ` : ''}{e.message}</li>)}
          </ul>
        </AlertBanner>
      )}
    </div>
  );
}
