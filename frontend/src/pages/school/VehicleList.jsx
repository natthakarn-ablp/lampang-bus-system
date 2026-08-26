import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bus, Pencil } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import PlateSearchInput from '../../components/PlateSearchInput';
import PageHeader from '../../components/PageHeader';
import VehicleRosterCard from '../../components/VehicleRosterCard';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { FormField, Modal, TableAction } from '../../components/ui';

export default function VehicleList() {
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [plateSearch, setPlateSearch] = useState(searchParams.get('plate') || '');
  const [expandedVehicle, setExpandedVehicle] = useState(null);
  const [studentCache, setStudentCache] = useState({});

  // ─── Edit vehicle (self-service) ──────────────────────────────────────
  const [editVehicle, setEditVehicle] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/school/vehicles')
      .then((res) => setVehicles(Array.isArray(res.data.data) ? res.data.data : []))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openEdit(v) {
    setEditVehicle(v);
    setEditForm({
      vehicle_type: v.vehicle_type || '',
      owner_name: v.owner_name || '',
      owner_phone: v.owner_phone || '',
      insurance_status: v.insurance_status || '',
      insurance_type: v.insurance_type || '',
      insurance_expiry: v.insurance_expiry ? String(v.insurance_expiry).slice(0, 10) : '',
    });
  }

  async function handleSaveEdit(e) {
    e.preventDefault();
    setSavingEdit(true);
    try {
      await api.put(`/school/vehicles/${editVehicle.id}`, editForm);
      toast.success('แก้ไขข้อมูลรถสำเร็จ');
      setEditVehicle(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'แก้ไขข้อมูลรถไม่สำเร็จ');
    } finally { setSavingEdit(false); }
  }

  const shown = vehicles.filter(
    v => !plateSearch || v.plate_no.toLowerCase().includes(plateSearch.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="รถรับส่ง"
        subtitle="รถรับส่งของโรงเรียน พร้อมคนขับ ผู้ดูแล และรายชื่อนักเรียน"
        actions={<PlateSearchInput value={plateSearch} onChange={setPlateSearch} suggestions={vehicles} />}
      />

      {error && <ErrorState message={error} className="mb-4" onRetry={load} />}

      {loading ? (
        <LoadingState />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Bus}
          title={plateSearch ? 'ไม่พบรถตามที่ค้นหา' : 'ไม่มีรถรับส่ง'}
          description={plateSearch ? 'ลองค้นด้วยทะเบียนอื่น' : 'ยังไม่มีรถในระบบ'}
        />
      ) : (
        <>
          <p className="text-sm text-ink-muted mb-3" aria-live="polite">
            {plateSearch ? 'พบ ' : 'ทั้งหมด '}
            <span className="font-semibold text-ink tabular-nums">{shown.length.toLocaleString('th-TH')}</span> คัน
          </p>
          <div className="grid gap-4">
            {shown.map(v => (
              <VehicleRosterCard
                key={`${v.id}-${v.driver_name || ''}-${v.attendant_name || ''}`}
                vehicle={v}
                studentsPath="/school/students"
                // The school owns these vehicles day to day: it needs the
                // driver's number to call, the photo to recognise them at the
                // gate, and the roster without a redundant school column.
                showContactPhones
                phoneLinks
                showDriverPhoto
                rosterColumns={['name', 'grade', 'parent', 'phone']}
                actions={
                  <TableAction tone="neutral" onClick={() => openEdit(v)}>
                    <Pencil className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden="true" />
                    แก้ไขข้อมูลรถ
                  </TableAction>
                }
              />
            ))}
          </div>
        </>
      )}

      {/* ─── Edit vehicle modal ────────────────────────────────────────── */}
      {editVehicle && (
        <Modal
          title="แก้ไขข้อมูลรถ"
          onClose={() => setEditVehicle(null)}
          footer={
            <>
              <button type="button" onClick={() => setEditVehicle(null)}
                className="focus-ring text-sm font-medium px-4 min-h-[44px] rounded-lg border border-surface-border bg-surface-raised text-ink hover:bg-surface active:bg-surface-border transition">
                ยกเลิก
              </button>
              <button type="submit" form="edit-vehicle-form" disabled={savingEdit}
                className="focus-ring text-sm font-semibold px-4 min-h-[44px] rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white disabled:opacity-50 disabled:pointer-events-none transition">
                {savingEdit ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </>
          }
        >
          <p className="text-sm text-ink-muted mb-4">{editVehicle.plate_no}</p>

          <form id="edit-vehicle-form" onSubmit={handleSaveEdit} className="space-y-3">
            <FormField
              label="ประเภทรถ"
              value={editForm.vehicle_type}
              onChange={v => setEditForm(f => ({ ...f, vehicle_type: v }))}
              placeholder="เช่น รถตู้ / รถสองแถว"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField
                label="ชื่อเจ้าของรถ"
                value={editForm.owner_name}
                onChange={v => setEditForm(f => ({ ...f, owner_name: v }))}
              />
              <FormField
                label="เบอร์เจ้าของรถ"
                type="tel"
                inputMode="numeric"
                value={editForm.owner_phone}
                onChange={v => setEditForm(f => ({ ...f, owner_phone: v }))}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField
                label="สถานะประกัน"
                value={editForm.insurance_status}
                onChange={v => setEditForm(f => ({ ...f, insurance_status: v }))}
                placeholder="เช่น มีประกัน / หมดอายุ"
              />
              <FormField
                label="ประเภทประกัน"
                value={editForm.insurance_type}
                onChange={v => setEditForm(f => ({ ...f, insurance_type: v }))}
                placeholder="เช่น ชั้น 1 / พ.ร.บ."
              />
            </div>
            <FormField label="วันหมดอายุประกัน">
              {ctl => (
                <input {...ctl} type="date" value={editForm.insurance_expiry}
                  onChange={e => setEditForm(f => ({ ...f, insurance_expiry: e.target.value }))}
                  className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition" />
              )}
            </FormField>
            <p className="text-caption text-ink-muted">
              ข้อมูลคนขับ ให้คนขับแก้ไขเองในหน้าโปรไฟล์คนขับ
            </p>
          </form>
        </Modal>
      )}
    </div>
  );
}
