import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import StatusBadge from '../../components/ui/StatusBadge';
import PageHeader from '../../components/PageHeader';
import Pagination from '../../components/Pagination';
import {
  AlertBanner, ConfirmDialog, DataTable, TableAction, FilterBar, FormField,
} from '../../components/ui';
import { todayBangkok } from '../../utils/thaiTime';

// Shared by the selects on this form; FormField supplies the label wiring.
const CONTROL_CLS = 'focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition';

const RESULT_OPTIONS = [
  { value: 'PASSED',   label: 'ผ่าน' },
  { value: 'FAILED',   label: 'ไม่ผ่าน' },
  { value: 'NEEDS_FIX',label: 'ต้องแก้ไข' },
  { value: 'PENDING',  label: 'รอตรวจ' },
];

const RESULT_VARIANT = {
  PASSED:    'success',
  FAILED:    'danger',
  NEEDS_FIX: 'warn',
  PENDING:   'neutral',
};

const PROVINCES = [
  'กรุงเทพมหานคร','กระบี่','กาญจนบุรี','กาฬสินธุ์','กำแพงเพชร','ขอนแก่น','จันทบุรี','ฉะเชิงเทรา',
  'ชลบุรี','ชัยนาท','ชัยภูมิ','ชุมพร','เชียงราย','เชียงใหม่','ตรัง','ตราด','ตาก','นครนายก','นครปฐม',
  'นครพนม','นครราชสีมา','นครศรีธรรมราช','นครสวรรค์','นนทบุรี','นราธิวาส','น่าน','บึงกาฬ','บุรีรัมย์',
  'ปทุมธานี','ประจวบคีรีขันธ์','ปราจีนบุรี','ปัตตานี','พะเยา','พระนครศรีอยุธยา','พังงา','พัทลุง',
  'พิจิตร','พิษณุโลก','เพชรบุรี','เพชรบูรณ์','แพร่','ภูเก็ต','มหาสารคาม','มุกดาหาร','แม่ฮ่องสอน',
  'ยโสธร','ยะลา','ร้อยเอ็ด','ระนอง','ระยอง','ราชบุรี','ลพบุรี','ลำปาง','ลำพูน','เลย','ศรีสะเกษ',
  'สกลนคร','สงขลา','สตูล','สมุทรปราการ','สมุทรสงคราม','สมุทรสาคร','สระแก้ว','สระบุรี','สิงห์บุรี',
  'สุโขทัย','สุพรรณบุรี','สุราษฎร์ธานี','สุรินทร์','หนองคาย','หนองบัวลำภู','อ่างทอง','อำนาจเจริญ',
  'อุดรธานี','อุตรดิตถ์','อุทัยธานี','อุบลราชธานี',
];

function formatThaiDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function InspectionForm() {
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const prefillVehicleId = searchParams.get('vehicle_id') || '';

  const [vehicles, setVehicles] = useState([]);
  const [schools, setSchools] = useState([]);
  const [inspections, setInspections] = useState([]);
  const [meta, setMeta] = useState({ page: 1, per_page: 20, total: 0 });
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(!!prefillVehicleId);
  const [saving, setSaving] = useState(false);
  // window.confirm could not show the plate and the date side by side, and
  // put the default action on OK.
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [resultFilter, setResultFilter] = useState('');

  const [form, setForm] = useState({
    vehicle_id: prefillVehicleId || '', inspection_date: todayBangkok(),
    expiry_date: '', result: 'PASSED', notes: '', certifying_school_id: '',
  });

  // Searchable dropdowns
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [schoolSearch, setSchoolSearch] = useState('');
  const [customSchoolName, setCustomSchoolName] = useState('');
  const isOtherSchool = form?.certifying_school_id === '__other__';
  const isOtherVehicle = form?.vehicle_id === '__other__';
  const [newPlate, setNewPlate] = useState({ prefix: '', letters: '', number: '', province: 'ลำปาง' });

  useEffect(() => {
    // `|| []` only catches null; a non-array payload reached .filter() below
    // and took the whole page into the error boundary.
    api.get('/transport/vehicles?per_page=200').then(r => setVehicles(Array.isArray(r.data?.data) ? r.data.data : [])).catch(err => console.error('[InspectionForm] vehicles load failed:', err.message));
    api.get('/transport/schools').then(r => setSchools(Array.isArray(r.data?.data) ? r.data.data : [])).catch(err => console.error('[InspectionForm] schools load failed:', err.message));
  }, []);

  const fetchInspections = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('per_page', '20');
      if (resultFilter) params.set('result', resultFilter);
      const res = await api.get(`/transport/inspections?${params}`);
      setInspections(res.data?.data || []);
      setMeta(res.data?.meta || { page: 1, per_page: 20, total: 0 });
    } catch (err) { console.error('[InspectionForm] inspections load failed:', err.message); } finally { setLoading(false); }
  }, [resultFilter]);

  useEffect(() => { fetchInspections(1); }, [fetchInspections]);

  async function handleDeleteInspection(ins) {
    setConfirmDelete(null);
    try {
      await api.delete(`/transport/inspections/${ins.id}`);
      toast.success('ลบผลตรวจสำเร็จ');
      fetchInspections(1);
    } catch (err) {
      toast.error(err.response?.data?.message || 'ลบผลตรวจไม่สำเร็จ');
    }
  }

  function buildPlateNo() {
    const { prefix, letters, number, province } = newPlate;
    if (!letters || !number || !province) return '';
    const parts = [];
    if (prefix) parts.push(prefix);
    parts.push(letters, number, province);
    return parts.join(' ');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.vehicle_id && !isOtherVehicle) { toast.error('กรุณาเลือกรถ'); return; }
    if (isOtherVehicle) {
      if (!/^[ก-ฮ]{2}$/.test(newPlate.letters)) { toast.error('หมวดอักษรต้องเป็นอักษรไทย 2 ตัว'); return; }
      if (!/^\d{1,4}$/.test(newPlate.number)) { toast.error('หมายเลขทะเบียนต้องเป็นตัวเลข 1-4 หลัก'); return; }
      if (!newPlate.province) { toast.error('กรุณาเลือกจังหวัด'); return; }
      if (newPlate.prefix && !/^\d$/.test(newPlate.prefix)) { toast.error('เลขนำหน้าต้องเป็นตัวเลข 0-9 หนึ่งตัว'); return; }
    }
    if (isOtherSchool && !customSchoolName.trim()) { toast.error('กรุณาระบุชื่อโรงเรียน'); return; }
    setSaving(true);
    try {
      const payload = { ...form };

      // Create new vehicle if "อื่นๆ"
      if (isOtherVehicle) {
        const plateNo = buildPlateNo();
        const vRes = await api.post('/transport/vehicles', { plate_no: plateNo });
        payload.vehicle_id = vRes.data.data.id;
        if (vRes.data.data.existed) toast.success(`รถ ${plateNo} มีในระบบแล้ว — ใช้ข้อมูลเดิม`);
      }

      if (isOtherSchool) {
        payload.certifying_school_id = '';
        payload.notes = `[โรงเรียนที่ออกใบรับรอง: ${customSchoolName.trim()}]${payload.notes ? ' ' + payload.notes : ''}`;
      }
      await api.post('/transport/inspections', payload);
      toast.success('บันทึกผลตรวจสำเร็จ');
      const savedVehicleId = form.vehicle_id;
      setShowForm(false);
      setForm({ vehicle_id: '', inspection_date: todayBangkok(), expiry_date: '', result: 'PASSED', notes: '', certifying_school_id: '' });
      setVehicleSearch('');
      setSchoolSearch('');
      setCustomSchoolName('');
      // Navigate back to dashboard with highlight
      if (prefillVehicleId && savedVehicleId) {
        navigate(`/transport?saved=${savedVehicleId}`);
        return;
      }
      fetchInspections(1);
    } catch (err) {
      toast.error(err.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally { setSaving(false); }
  }

  const filteredVehicles = (vehicles || []).filter(v =>
    !vehicleSearch || v.plate_no?.toLowerCase().includes(vehicleSearch.toLowerCase())
  );
  const filteredSchools = (schools || []).filter(s =>
    !schoolSearch || s.name?.toLowerCase().includes(schoolSearch.toLowerCase())
  );

  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        icon={ClipboardList}
        title="บันทึกตรวจสภาพรถ"
        subtitle="บันทึกและดูประวัติการตรวจสภาพ"
        actions={(
          <>
            <button
              type="button"
              onClick={() => navigate('/transport/verification')}
              className="focus-ring border border-brand-200 bg-brand-50 hover:bg-brand-100 text-brand-700 text-sm font-medium px-4 min-h-[44px] rounded-lg transition"
            >
              ไปหน้าตรวจและรับรองรถ
            </button>
            <button
              type="button"
              onClick={() => setShowForm(!showForm)}
              aria-expanded={showForm}
              className="focus-ring bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-sm font-semibold px-5 min-h-[44px] rounded-lg transition"
            >
              {showForm ? 'ปิดฟอร์ม' : 'บันทึกผลตรวจเดิม'}
            </button>
          </>
        )}
      />

      {/* แจ้งให้ใช้หน้าใหม่ — หน้านี้เป็นบันทึกแบบเดิม.
          The ⚠️ was the only thing marking this as the legacy page. */}
      <AlertBanner variant="warn" title="หน้านี้เป็นบันทึกแบบเดิม" className="mb-5">
        เก็บไว้ดูประวัติ — สำหรับตรวจและรับรองรถ ให้ใช้เมนู “ตรวจและรับรองรถ”
      </AlertBanner>

      {/* Prefill indicator */}
      {prefillVehicleId && showForm && (() => {
        const pv = vehicles.find(v => v.id === prefillVehicleId);
        return pv ? (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-3 text-sm text-blue-700">
            กำลังบันทึกผลตรวจสำหรับรถ: <strong>{pv.plate_no}</strong>
          </div>
        ) : null;
      })()}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Searchable vehicle select */}
            <div className="sm:col-span-2 space-y-2">
              {!isOtherVehicle && (
                <FormField
                  label="ค้นหาทะเบียนรถ"
                  value={vehicleSearch}
                  onChange={setVehicleSearch}
                  placeholder="พิมพ์ทะเบียนรถเพื่อค้นหา…"
                  helper="พิมพ์เพื่อกรองรายการด้านล่าง"
                />
              )}
              <FormField label="เลือกรถ" required>
                {ctl => (
                  <select
                    {...ctl}
                    value={form.vehicle_id}
                    onChange={e => { setForm({ ...form, vehicle_id: e.target.value }); if (e.target.value !== '__other__') setNewPlate({ prefix: '', letters: '', number: '', province: 'ลำปาง' }); }}
                    className={CONTROL_CLS}
                  >
                    <option value="">— เลือกรถ —</option>
                    {filteredVehicles.map(v => <option key={v.id} value={v.id}>{v.plate_no}</option>)}
                    <option value="__other__">อื่นๆ (เพิ่มทะเบียนรถใหม่)</option>
                  </select>
                )}
              </FormField>

              {/* New plate structured input */}
              {isOtherVehicle && (
                <div className="mt-3 bg-warn-soft border border-warn/30 rounded-lg p-4 space-y-3">
                  <p className="text-sm font-semibold text-warn-ink">กรอกทะเบียนรถใหม่</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <FormField
                      label="เลขนำหน้า"
                      value={newPlate.prefix}
                      maxLength={1}
                      inputMode="numeric"
                      onChange={v => setNewPlate({ ...newPlate, prefix: v.replace(/[^0-9]/g, '') })}
                      placeholder="1"
                    />
                    <FormField
                      label="หมวดอักษร"
                      required
                      value={newPlate.letters}
                      maxLength={2}
                      onChange={v => setNewPlate({ ...newPlate, letters: v.replace(/[^ก-ฮ]/g, '') })}
                      placeholder="กข"
                    />
                    <FormField
                      label="หมายเลข"
                      required
                      value={newPlate.number}
                      maxLength={4}
                      inputMode="numeric"
                      onChange={v => setNewPlate({ ...newPlate, number: v.replace(/[^0-9]/g, '') })}
                      placeholder="1234"
                    />
                    <FormField label="จังหวัด" required>
                      {ctl => (
                        <select
                          {...ctl}
                          value={newPlate.province}
                          onChange={e => setNewPlate({ ...newPlate, province: e.target.value })}
                          className={CONTROL_CLS}
                        >
                          <option value="">เลือก</option>
                          {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      )}
                    </FormField>
                  </div>
                  {buildPlateNo() && (
                    <p className="text-sm text-ink bg-surface-raised rounded-lg px-3 py-2 border border-surface-border">
                      ทะเบียน: <strong>{buildPlateNo()}</strong>
                    </p>
                  )}
                </div>
              )}
            </div>
            <FormField label="ผลตรวจ" required>
              {ctl => (
                <select
                  {...ctl}
                  value={form.result}
                  onChange={e => setForm({ ...form, result: e.target.value })}
                  className={CONTROL_CLS}
                >
                  {RESULT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </FormField>
            <FormField
              label="วันที่ตรวจ"
              required
              type="date"
              value={form.inspection_date}
              onChange={v => setForm({ ...form, inspection_date: v })}
            />
            <FormField
              label="วันหมดอายุผลตรวจ"
              type="date"
              value={form.expiry_date}
              onChange={v => setForm({ ...form, expiry_date: v })}
              error={form.expiry_date && form.inspection_date && form.expiry_date < form.inspection_date
                ? 'วันหมดอายุต้องไม่ก่อนวันที่ตรวจ' : undefined}
            />
          </div>

          {/* Searchable school select */}
          <div className="space-y-2">
            <FormField
              label="ค้นหาโรงเรียน"
              value={schoolSearch}
              onChange={setSchoolSearch}
              placeholder="พิมพ์ชื่อโรงเรียนเพื่อค้นหา…"
              helper="พิมพ์เพื่อกรองรายการด้านล่าง"
            />
            <FormField label="โรงเรียนที่ออกใบรับรอง">
              {ctl => (
                <select
                  {...ctl}
                  value={form.certifying_school_id}
                  onChange={e => { setForm({ ...form, certifying_school_id: e.target.value }); if (e.target.value !== '__other__') setCustomSchoolName(''); }}
                  size={Math.min(filteredSchools.length + 3, 8)}
                  className="focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 py-2 text-base text-ink transition"
                >
                  <option value="">-- เลือกโรงเรียน --</option>
                  {filteredSchools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  <option value="__other__">อื่นๆ (ระบุเอง)</option>
                </select>
              )}
            </FormField>
            {isOtherSchool && (
              <FormField
                label="ระบุชื่อโรงเรียน"
                required
                value={customSchoolName}
                onChange={setCustomSchoolName}
                placeholder="กรุณาระบุชื่อโรงเรียน"
              />
            )}
          </div>

          <FormField
            label="หมายเหตุ"
            helper="ไม่บังคับ"
            value={form.notes}
            onChange={v => setForm({ ...form, notes: v })}
            placeholder="รายละเอียดเพิ่มเติม"
          />

          <button
            type="submit"
            disabled={saving}
            className="focus-ring w-full sm:w-auto bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50 disabled:pointer-events-none text-white font-semibold px-6 min-h-[48px] rounded-lg transition"
          >
            {saving ? 'กำลังบันทึก…' : 'บันทึกผลตรวจ'}
          </button>
        </form>
      )}

      <FilterBar
        className="mb-4"
        filters={[{
          key: 'result',
          label: 'ผลตรวจ',
          value: resultFilter,
          onChange: setResultFilter,
          options: [['', 'ทุกผลตรวจ'], ...RESULT_OPTIONS.map(o => [o.value, o.label])],
        }]}
        count={meta.total}
        countLabel="ผลตรวจ"
        onClear={resultFilter ? () => setResultFilter('') : undefined}
      />

      {loading ? (
        <LoadingState />
      ) : inspections.length === 0 ? (
        <EmptyState icon={ClipboardList} title="ไม่มีบันทึกการตรวจ" description="เริ่มบันทึกผลตรวจรถคันใหม่จากฟอร์มด้านบน" />
      ) : (
        <>
          {/* One column definition, so the desktop row and the mobile card
              cannot drift the way these two had. */}
          <DataTable
            caption="ประวัติการตรวจสภาพรถ"
            columns={[
              { key: 'plate_no', header: 'ทะเบียนรถ', primary: true, cell: ins => ins.plate_no },
              { key: 'result', header: 'ผลตรวจ', align: 'center', badge: true,
                cell: ins => (
                  <StatusBadge variant={RESULT_VARIANT[ins.result] || 'neutral'} size="sm">
                    {RESULT_OPTIONS.find(o => o.value === ins.result)?.label || ins.result}
                  </StatusBadge>
                ) },
              { key: 'inspection_date', header: 'วันที่ตรวจ', secondary: true, cell: ins => formatThaiDate(ins.inspection_date) },
              { key: 'expiry_date', header: 'หมดอายุ', cell: ins => formatThaiDate(ins.expiry_date) },
              { key: 'inspector_name', header: 'ผู้ตรวจ', cell: ins => ins.inspector_name || '-' },
              { key: 'notes', header: 'หมายเหตุ', cell: ins => ins.notes || '-' },
            ]}
            rows={inspections}
            actions={ins => (
              <TableAction tone="danger" onClick={() => setConfirmDelete(ins)}>
                ลบผลตรวจ
              </TableAction>
            )}
          />

          {totalPages > 1 && (
            <Pagination page={meta.page} totalPages={totalPages} total={meta.total} shown={inspections.length} onPage={(p) => fetchInspections(p)} />
          )}
        </>
      )}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="ลบผลตรวจนี้?"
        itemName={confirmDelete ? `${confirmDelete.plate_no} · ${formatThaiDate(confirmDelete.inspection_date)}` : undefined}
        description="ระบบจะคำนวณสถานะรถใหม่หลังลบ — ลบได้เฉพาะผลตรวจที่คุณบันทึกเอง"
        confirmLabel="ลบผลตรวจ"
        onConfirm={() => handleDeleteInspection(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
