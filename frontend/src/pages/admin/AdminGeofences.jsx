import { useEffect, useState, useCallback } from 'react';
import { MapPin, Plus, Sparkles, Power, Trash2 } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';
import SectionTitle from '../../components/ui/SectionTitle';
import AlertBanner from '../../components/ui/AlertBanner';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import DataTable from '../../components/ui/DataTable';
import FormField from '../../components/ui/FormField';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';

// Phase 11A — Geofence management (admin). CRUD + seed-defaults + event log.

const TARGET_LABEL = {
  SCHOOL: 'โรงเรียน',
  PICKUP_POINT: 'จุดรับ-ส่ง',
  DEPOT: 'จุดตั้งต้น',
};
const TRIGGER_LABEL = {
  BOTH: 'เข้า + ออก',
  ENTER: 'เข้าเท่านั้น',
  EXIT: 'ออกเท่านั้น',
};

const controlCls = 'focus-ring w-full min-h-[44px] rounded-lg border border-surface-border bg-surface-raised px-3 text-base sm:text-sm text-ink transition';

const EMPTY_FORM = {
  name: '', target_type: 'PICKUP_POINT', target_id: '', vehicle_id: '',
  center_lat: '', center_lng: '', radius_meters: 150, trigger_on: 'BOTH',
  notify_roles: 'parent,school',
};

export default function AdminGeofences() {
  const toast = useToast();
  const [geofences, setGeofences] = useState([]);
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  // A failed load raised a toast and then rendered "ยังไม่มีจุดเตือนภัย",
  // which invites an admin to seed defaults over data that may already exist.
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  // Both destructive paths used the bare global confirm(): no dialog
  // semantics, no focus management, and the default action was OK.
  const [confirmSeed, setConfirmSeed] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [gf, ev] = await Promise.all([
        api.get('/geofences'),
        api.get('/geofences/events/list?limit=50'),
      ]);
      setGeofences(Array.isArray(gf.data?.data) ? gf.data.data : []);
      setEvents(Array.isArray(ev.data?.data) ? ev.data.data : []);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลจุดเตือนภัยไม่สำเร็จ');
      setGeofences([]);
      setEvents([]);
    } finally { setBusy(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function seedDefaults() {
    setBusy(true);
    try {
      const res = await api.post('/geofences/seed-defaults');
      toast.success(res.data.message || 'สร้างเรียบร้อย');
      setConfirmSeed(false);
      await load();
    } catch { toast.error('สร้างไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  async function toggleActive(gf) {
    try {
      await api.put(`/geofences/${gf.id}`, { is_active: !gf.is_active });
      toast.success(gf.is_active ? 'ปิดใช้งานแล้ว' : 'เปิดใช้งานแล้ว');
      await load();
    } catch { toast.error('แก้ไขไม่สำเร็จ'); }
  }

  async function removeGf(gf) {
    try {
      await api.delete(`/geofences/${gf.id}`);
      toast.success('ปิดใช้งานแล้ว');
      setConfirmRemove(null);
      await load();
    } catch { toast.error('ลบไม่สำเร็จ'); }
  }

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function submitForm(e) {
    e.preventDefault();
    if (saving) return;
    if (!form.name || !form.center_lat || !form.center_lng) {
      toast.error('กรุณากรอกชื่อ + พิกัด');
      return;
    }
    // Phase 11A audit fix C3: validate coordinates before submission
    const lat = parseFloat(form.center_lat);
    const lng = parseFloat(form.center_lng);
    if (isNaN(lat) || isNaN(lng)) {
      toast.error('พิกัดต้องเป็นตัวเลข');
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      toast.error('พิกัดไม่ถูกต้อง (ละติจูด: -90 ถึง 90, ลองจิจูด: -180 ถึง 180)');
      return;
    }
    const radius = parseInt(form.radius_meters, 10) || 150;
    if (radius <= 0 || radius > 50000) {
      toast.error('รัศมีต้องเป็นตัวเลขบวก (1-50000 เมตร)');
      return;
    }
    setSaving(true);
    try {
      await api.post('/geofences', {
        ...form,
        target_id: form.target_id || null,
        vehicle_id: form.vehicle_id || null,
        center_lat: lat,
        center_lng: lng,
        radius_meters: radius,
      });
      toast.success('สร้างจุดเตือนภัยแล้ว');
      setShowForm(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) { toast.error(err.response?.data?.message || 'สร้างไม่สำเร็จ'); }
    finally { setSaving(false); }
  }

  // Same field errors the submit handler enforces, shown next to the field
  // rather than only as a toast after the attempt.
  const latNum = parseFloat(form.center_lat);
  const lngNum = parseFloat(form.center_lng);
  const latError = form.center_lat && (isNaN(latNum) || latNum < -90 || latNum > 90)
    ? 'ต้องเป็นตัวเลขระหว่าง -90 ถึง 90' : undefined;
  const lngError = form.center_lng && (isNaN(lngNum) || lngNum < -180 || lngNum > 180)
    ? 'ต้องเป็นตัวเลขระหว่าง -180 ถึง 180' : undefined;
  const radiusNum = parseInt(form.radius_meters, 10);
  const radiusError = form.radius_meters !== '' && (isNaN(radiusNum) || radiusNum <= 0 || radiusNum > 50000)
    ? 'ต้องอยู่ระหว่าง 1 ถึง 50000 เมตร' : undefined;

  const eventColumns = [
    {
      key: 'occurred_at', header: 'เวลา', secondary: true,
      cell: ev => new Date(ev.occurred_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }),
    },
    { key: 'geofence_name', header: 'จุดเตือนภัย', primary: true, cell: ev => ev.geofence_name },
    {
      key: 'vehicle_id', header: 'รถ',
      cell: ev => <span className="font-mono text-xs">{ev.vehicle_id}</span>,
    },
    {
      key: 'event_type', header: 'เหตุการณ์', badge: true,
      cell: ev => (
        <StatusBadge variant={ev.event_type === 'ENTER' ? 'success' : 'info'} size="sm">
          {ev.event_type === 'ENTER' ? 'เข้า' : 'ออก'}
        </StatusBadge>
      ),
    },
    { key: 'notifications_sent', header: 'แจ้งแล้ว', align: 'right', numeric: true, cell: ev => ev.notifications_sent },
  ];

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto motion-safe:animate-fade-in-up motion-reduce:animate-none">
      <PageHeader
        icon={MapPin}
        title="จุดเตือนภัย (Geofences)"
        subtitle="กำหนดพื้นที่เสมือนรอบโรงเรียน/จุดรับ-ส่ง — รถเข้า/ออกจะแจ้งเตือนอัตโนมัติ"
        actions={(
          <>
            <button
              type="button"
              onClick={() => setConfirmSeed(true)}
              disabled={busy}
              className="focus-ring inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-surface-raised border border-surface-border px-3 text-sm font-semibold text-ink transition hover:bg-surface disabled:opacity-50 disabled:pointer-events-none"
            >
              <Sparkles className="w-4 h-4" aria-hidden="true" /> สร้างอัตโนมัติ
            </button>
            <button
              type="button"
              onClick={() => setShowForm(!showForm)}
              aria-expanded={showForm}
              className="focus-ring inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700 active:bg-brand-800"
            >
              <Plus className="w-4 h-4" aria-hidden="true" /> เพิ่มจุด
            </button>
          </>
        )}
      />

      {showForm && (
        <AppCard padding="md" className="mb-4">
          <form onSubmit={submitForm} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField
              className="sm:col-span-2"
              label="ชื่อจุดเตือนภัย"
              required
              value={form.name}
              onChange={v => update('name', v)}
              placeholder="เช่น จุดรับ-ส่ง: หน้าปากซอย A"
            />

            <FormField label="ประเภท">
              {ctl => (
                <select {...ctl} className={controlCls} value={form.target_type}
                  onChange={(e) => update('target_type', e.target.value)}>
                  <option value="PICKUP_POINT">จุดรับ-ส่ง</option>
                  <option value="SCHOOL">โรงเรียน</option>
                  <option value="DEPOT">จุดตั้งต้น</option>
                </select>
              )}
            </FormField>

            <FormField
              label="รัศมี (เมตร)"
              type="number"
              value={form.radius_meters}
              onChange={v => update('radius_meters', v)}
              error={radiusError}
              helper="1 ถึง 50000"
            />

            <FormField
              label="ละติจูด"
              required
              value={form.center_lat}
              onChange={v => update('center_lat', v)}
              placeholder="18.7925"
              error={latError}
            />
            <FormField
              label="ลองจิจูด"
              required
              value={form.center_lng}
              onChange={v => update('center_lng', v)}
              placeholder="99.1025"
              error={lngError}
            />

            <FormField label="ทริกเกอร์">
              {ctl => (
                <select {...ctl} className={controlCls} value={form.trigger_on}
                  onChange={(e) => update('trigger_on', e.target.value)}>
                  <option value="BOTH">เข้า + ออก</option>
                  <option value="ENTER">เข้าเท่านั้น</option>
                  <option value="EXIT">ออกเท่านั้น</option>
                </select>
              )}
            </FormField>

            <FormField
              label="แจ้งเตือนบทบาท"
              value={form.notify_roles}
              onChange={v => update('notify_roles', v)}
              placeholder="parent,school"
              helper="คั่นด้วยเครื่องหมายจุลภาค"
            />

            <div className="sm:col-span-2 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
                className="focus-ring rounded-lg border border-surface-border px-4 min-h-[44px] text-sm font-medium text-ink hover:bg-surface transition"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={saving}
                className="focus-ring rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 px-4 min-h-[44px] text-sm font-semibold text-white transition disabled:opacity-50 disabled:pointer-events-none"
              >
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </form>
        </AppCard>
      )}

      {busy && geofences.length === 0 ? (
        <LoadingState message="กำลังโหลดจุดเตือนภัย…" />
      ) : error ? (
        <ErrorState title="โหลดข้อมูลไม่สำเร็จ" message={error} onRetry={load} />
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-2 mb-6">
            {geofences.length === 0 && (
              <li>
                <AlertBanner variant="info" title="ยังไม่มีจุดเตือนภัย">
                  กด “สร้างอัตโนมัติ” เพื่อสร้างจากจุดรับ-ส่งและโรงเรียนที่มีอยู่
                </AlertBanner>
              </li>
            )}
            {geofences.map((gf) => (
              <li key={gf.id}>
                <AppCard padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <MapPin className="w-5 h-5 text-brand-600 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink truncate">{gf.name}</div>
                      <div className="text-xs text-ink-muted">
                        {TARGET_LABEL[gf.target_type] || gf.target_type} · รัศมี {gf.radius_meters} เมตร
                        {' · '}{TRIGGER_LABEL[gf.trigger_on] || gf.trigger_on}
                        {gf.plate_no ? ` · รถ ${gf.plate_no}` : ' · ทุกคัน'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge variant={gf.is_active ? 'success' : 'neutral'} size="sm">
                      {gf.is_active ? 'เปิด' : 'ปิด'}
                    </StatusBadge>
                    {/* These were icon-only with a `title` and a 32px hit box —
                        no accessible name, and unusable with a thumb. */}
                    <button
                      type="button"
                      onClick={() => toggleActive(gf)}
                      aria-label={`${gf.is_active ? 'ปิด' : 'เปิด'}ใช้งานจุดเตือนภัย ${gf.name}`}
                      className="focus-ring inline-flex items-center justify-center w-11 h-11 rounded-lg text-ink-muted hover:bg-surface hover:text-ink transition"
                    >
                      <Power className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(gf)}
                      aria-label={`ปิดใช้งานถาวรจุดเตือนภัย ${gf.name}`}
                      className="focus-ring inline-flex items-center justify-center w-11 h-11 rounded-lg text-danger-ink hover:bg-danger-soft transition"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </AppCard>
              </li>
            ))}
          </ul>

          <SectionTitle title="เหตุการณ์ล่าสุด" description="การเข้า/ออกจุดเตือนภัย 50 รายการล่าสุด" className="mb-3" />
          <DataTable
            caption="เหตุการณ์เข้า/ออกจุดเตือนภัยล่าสุด"
            columns={eventColumns}
            rows={events}
            empty={{ title: 'ยังไม่มีเหตุการณ์' }}
          />
        </>
      )}

      <ConfirmDialog
        open={confirmSeed}
        tone="warn"
        title="สร้างจุดเตือนภัยเริ่มต้น?"
        description="ระบบจะสร้างจุดเตือนภัยให้ทุกจุดรับ-ส่งและโรงเรียนที่ยังไม่มี — จุดที่มีอยู่แล้วจะไม่ถูกแก้ไข"
        confirmLabel="สร้างอัตโนมัติ"
        loading={busy}
        onConfirm={seedDefaults}
        onCancel={() => setConfirmSeed(false)}
      />

      <ConfirmDialog
        open={Boolean(confirmRemove)}
        title="ปิดใช้งานจุดเตือนภัยนี้?"
        itemName={confirmRemove?.name}
        description="จุดนี้จะหยุดแจ้งเตือนทันที ประวัติเหตุการณ์ที่บันทึกไว้แล้วจะยังคงอยู่"
        confirmLabel="ปิดใช้งาน"
        onConfirm={() => removeGf(confirmRemove)}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}
