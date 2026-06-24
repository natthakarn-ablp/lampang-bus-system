import { useEffect, useState } from 'react';
import { MapPin, Plus, Sparkles, Power, Trash2 } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';
import SectionTitle from '../../components/ui/SectionTitle';
import AlertBanner from '../../components/ui/AlertBanner';
import LoadingState from '../../components/LoadingState';

// Phase 11A — Geofence management (admin). CRUD + seed-defaults + event log.

const TARGET_LABEL = {
  SCHOOL: 'โรงเรียน',
  PICKUP_POINT: 'จุดรับ-ส่ง',
  DEPOT: 'จุดตั้งต้น',
};

const inputCls = 'w-full min-h-[44px] rounded-lg border border-surface-border bg-surface-raised px-3 py-2 text-sm text-ink transition focus:border-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30';

export default function AdminGeofences() {
  const toast = useToast();
  const [geofences, setGeofences] = useState([]);
  const [events, setEvents] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '', target_type: 'PICKUP_POINT', target_id: '', vehicle_id: '',
    center_lat: '', center_lng: '', radius_meters: 150, trigger_on: 'BOTH',
    notify_roles: 'parent,school',
  });

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);
  async function load() {
    setBusy(true);
    try {
      const [gf, ev] = await Promise.all([
        api.get('/geofences'),
        api.get('/geofences/events/list?limit=50'),
      ]);
      setGeofences(gf.data.data || []);
      setEvents(ev.data.data || []);
    } catch { toast.error('โหลดข้อมูลไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  async function seedDefaults() {
    if (!confirm('สร้างจุดเตือนภัยเริ่มต้นสำหรับทุกจุดรับ-ส่งและโรงเรียนที่ยังไม่มี?')) return;
    setBusy(true);
    try {
      const res = await api.post('/geofences/seed-defaults');
      toast.success(res.data.message || 'สร้างเรียบร้อย');
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
    if (!confirm(`ปิดใช้งานจุดเตือนภัย "${gf.name}"?`)) return;
    try {
      await api.delete(`/geofences/${gf.id}`);
      toast.success('ปิดใช้งานแล้ว');
      await load();
    } catch { toast.error('ลบไม่สำเร็จ'); }
  }

  async function submitForm(e) {
    e.preventDefault();
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
      setForm({ name: '', target_type: 'PICKUP_POINT', target_id: '', vehicle_id: '',
        center_lat: '', center_lng: '', radius_meters: 150, trigger_on: 'BOTH',
        notify_roles: 'parent,school' });
      await load();
    } catch (err) { toast.error(err.response?.data?.message || 'สร้างไม่สำเร็จ'); }
  }

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto motion-safe:animate-fade-in-up motion-reduce:animate-none">
      <SectionTitle
        title="จุดเตือนภัย (Geofences)"
        description="กำหนดพื้นที่เสมือนรอบโรงเรียน/จุดรับ-ส่ง — รถเข้า/ออกจะแจ้งเตือนอัตโนมัติ"
        className="mb-4"
        action={(
          <div className="flex gap-2">
            <button onClick={seedDefaults} disabled={busy}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-surface-raised border border-surface-border px-3 py-2 text-sm font-semibold text-ink transition hover:bg-surface-hover">
              <Sparkles className="w-4 h-4" /> สร้างอัตโนมัติ
            </button>
            <button onClick={() => setShowForm(!showForm)}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700">
              <Plus className="w-4 h-4" /> เพิ่มจุด
            </button>
          </div>
        )}
      />

      {busy && geofences.length === 0 ? (
        <LoadingState label="กำลังโหลดจุดเตือนภัย..." />
      ) : null}

      {showForm && (
        <AppCard padding="md" className="mb-4">
          <form onSubmit={submitForm} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-ink-muted">ชื่อจุดเตือนภัย</label>
              <input className={inputCls} value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="เช่น จุดรับ-ส่ง: หน้าปากซอย A" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-muted">ประเภท</label>
              <select className={inputCls} value={form.target_type}
                onChange={(e) => setForm({ ...form, target_type: e.target.value })}>
                <option value="PICKUP_POINT">จุดรับ-ส่ง</option>
                <option value="SCHOOL">โรงเรียน</option>
                <option value="DEPOT">จุดตั้งต้น</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-ink-muted">รัศมี (เมตร)</label>
              <input type="number" className={inputCls} value={form.radius_meters}
                onChange={(e) => setForm({ ...form, radius_meters: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-muted">ละติจูด</label>
              <input className={inputCls} value={form.center_lat}
                onChange={(e) => setForm({ ...form, center_lat: e.target.value })}
                placeholder="18.7925" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-muted">ลองจิจูด</label>
              <input className={inputCls} value={form.center_lng}
                onChange={(e) => setForm({ ...form, center_lng: e.target.value })}
                placeholder="99.1025" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-muted">ทริกเกอร์</label>
              <select className={inputCls} value={form.trigger_on}
                onChange={(e) => setForm({ ...form, trigger_on: e.target.value })}>
                <option value="BOTH">เข้า + ออก</option>
                <option value="ENTER">เข้าเท่านั้น</option>
                <option value="EXIT">ออกเท่านั้น</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-ink-muted">แจ้งเตือนบทบาท</label>
              <input className={inputCls} value={form.notify_roles}
                onChange={(e) => setForm({ ...form, notify_roles: e.target.value })}
                placeholder="parent,school" />
            </div>
            <div className="sm:col-span-2 flex gap-2 justify-end">
              <button type="button" onClick={() => setShowForm(false)}
                className="rounded-lg border border-surface-border px-4 py-2 text-sm">ยกเลิก</button>
              <button type="submit"
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">บันทึก</button>
            </div>
          </form>
        </AppCard>
      )}

      <div className="grid grid-cols-1 gap-2 mb-6">
        {geofences.length === 0 && !busy && (
          <AlertBanner tone="info">ยังไม่มีจุดเตือนภัย — กด "สร้างอัตโนมัติ" เพื่อสร้างจากจุดรับ-ส่งและโรงเรียนที่มีอยู่</AlertBanner>
        )}
        {geofences.map((gf) => (
          <AppCard key={gf.id} padding="sm" className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <MapPin className="w-5 h-5 text-brand-600 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink truncate">{gf.name}</div>
                <div className="text-xs text-ink-muted">
                  {TARGET_LABEL[gf.target_type]} · รัศมี {gf.radius_meters}m · {gf.trigger_on}
                  {gf.plate_no ? ` · รถ ${gf.plate_no}` : ' · ทุกคัน'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StatusBadge variant={gf.is_active ? 'success' : 'neutral'} size="sm">
                {gf.is_active ? 'เปิด' : 'ปิด'}
              </StatusBadge>
              <button onClick={() => toggleActive(gf)} title="เปิด/ปิด"
                className="p-2 rounded-lg hover:bg-surface-hover">
                <Power className="w-4 h-4" />
              </button>
              <button onClick={() => removeGf(gf)} title="ปิดใช้งาน"
                className="p-2 rounded-lg hover:bg-surface-hover text-danger-600">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </AppCard>
        ))}
      </div>

      <SectionTitle title="เหตุการณ์ล่าสุด" description="การเข้า/ออกจุดเตือนภัย 50 รายการล่าสุด" className="mb-3" />
      <div className="overflow-x-auto rounded-lg border border-surface-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-hover text-ink-muted text-xs">
            <tr>
              <th className="text-left px-3 py-2">เวลา</th>
              <th className="text-left px-3 py-2">จุดเตือนภัย</th>
              <th className="text-left px-3 py-2">รถ</th>
              <th className="text-left px-3 py-2">เหตุการณ์</th>
              <th className="text-right px-3 py-2">แจ้งแล้ว</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-muted">ยังไม่มีเหตุการณ์</td></tr>
            )}
            {events.map((ev) => (
              <tr key={ev.id} className="border-t border-surface-border">
                <td className="px-3 py-2 text-ink-muted">
                  {new Date(ev.occurred_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}
                </td>
                <td className="px-3 py-2">{ev.geofence_name}</td>
                <td className="px-3 py-2 font-mono text-xs">{ev.vehicle_id}</td>
                <td className="px-3 py-2">
                  <StatusBadge variant={ev.event_type === 'ENTER' ? 'success' : 'info'} size="sm">
                    {ev.event_type === 'ENTER' ? 'เข้า' : 'ออก'}
                  </StatusBadge>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{ev.notifications_sent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
