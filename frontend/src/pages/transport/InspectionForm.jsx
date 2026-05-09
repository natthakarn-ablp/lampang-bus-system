import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import AppCard from '../../components/ui/AppCard';
import StatusBadge from '../../components/ui/StatusBadge';

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
  const [resultFilter, setResultFilter] = useState('');

  const [form, setForm] = useState({
    vehicle_id: prefillVehicleId || '', inspection_date: new Date().toISOString().slice(0, 10),
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
    api.get('/transport/vehicles?per_page=200').then(r => setVehicles(r.data?.data || [])).catch(err => console.error('[InspectionForm] vehicles load failed:', err.message));
    api.get('/transport/schools').then(r => setSchools(r.data?.data || [])).catch(err => console.error('[InspectionForm] schools load failed:', err.message));
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
      setForm({ vehicle_id: '', inspection_date: new Date().toISOString().slice(0, 10), expiry_date: '', result: 'PASSED', notes: '', certifying_school_id: '' });
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
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-800">บันทึกตรวจสภาพรถ</h1>
          <p className="text-xs text-gray-400 mt-0.5">บันทึกและดูประวัติการตรวจสภาพ</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-lg transition">
          {showForm ? 'ปิดฟอร์ม' : 'บันทึกผลตรวจ'}
        </button>
      </div>

      {/* Prefill indicator */}
      {prefillVehicleId && showForm && (() => {
        const pv = vehicles.find(v => v.id === prefillVehicleId);
        return pv ? (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-3 text-sm text-blue-700">
            📝 กำลังบันทึกผลตรวจสำหรับรถ: <strong>{pv.plate_no}</strong>
          </div>
        ) : null;
      })()}

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Searchable vehicle select */}
            <div className="sm:col-span-2">
              <label className="block text-sm text-gray-600 mb-1">เลือกรถ <span className="text-red-500">*</span></label>
              {!isOtherVehicle && (
                <input type="text" value={vehicleSearch} onChange={e => setVehicleSearch(e.target.value)}
                  placeholder="พิมพ์ทะเบียนรถเพื่อค้นหา…"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-base mb-1 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              )}
              <select value={form.vehicle_id}
                onChange={e => { setForm({ ...form, vehicle_id: e.target.value }); if (e.target.value !== '__other__') setNewPlate({ prefix: '', letters: '', number: '', province: 'ลำปาง' }); }}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">— เลือกรถ —</option>
                {filteredVehicles.map(v => <option key={v.id} value={v.id}>{v.plate_no}</option>)}
                <option value="__other__">อื่นๆ (เพิ่มทะเบียนรถใหม่)</option>
              </select>

              {/* New plate structured input */}
              {isOtherVehicle && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                  <p className="text-sm font-semibold text-amber-800">กรอกทะเบียนรถใหม่</p>
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">เลขนำหน้า</label>
                      <input type="text" value={newPlate.prefix} maxLength={1}
                        onChange={e => setNewPlate({ ...newPlate, prefix: e.target.value.replace(/[^0-9]/g, '') })}
                        placeholder="1" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base text-center focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">หมวดอักษร <span className="text-red-500">*</span></label>
                      <input type="text" value={newPlate.letters} maxLength={2}
                        onChange={e => setNewPlate({ ...newPlate, letters: e.target.value.replace(/[^ก-ฮ]/g, '') })}
                        placeholder="กข" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base text-center focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">หมายเลข <span className="text-red-500">*</span></label>
                      <input type="text" value={newPlate.number} maxLength={4}
                        onChange={e => setNewPlate({ ...newPlate, number: e.target.value.replace(/[^0-9]/g, '') })}
                        placeholder="1234" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base text-center focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">จังหวัด <span className="text-red-500">*</span></label>
                      <select value={newPlate.province} onChange={e => setNewPlate({ ...newPlate, province: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-2 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                        <option value="">เลือก</option>
                        {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  </div>
                  {buildPlateNo() && (
                    <p className="text-sm text-gray-700 bg-white rounded-lg px-3 py-2 border">
                      ทะเบียน: <strong>{buildPlateNo()}</strong>
                    </p>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">ผลตรวจ <span className="text-red-500">*</span></label>
              <select value={form.result} onChange={e => setForm({ ...form, result: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-400">
                {RESULT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">วันที่ตรวจ</label>
              <input type="date" value={form.inspection_date}
                onChange={e => setForm({ ...form, inspection_date: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">วันหมดอายุผลตรวจ</label>
              <input type="date" value={form.expiry_date}
                onChange={e => setForm({ ...form, expiry_date: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
          </div>

          {/* Searchable school select */}
          <div>
            <label className="block text-sm text-gray-600 mb-1">โรงเรียนที่ออกใบรับรอง</label>
            <input type="text" value={schoolSearch} onChange={e => setSchoolSearch(e.target.value)}
              placeholder="พิมพ์ชื่อโรงเรียนเพื่อค้นหา…"
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-base mb-1 focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <select value={form.certifying_school_id}
              onChange={e => { setForm({ ...form, certifying_school_id: e.target.value }); if (e.target.value !== '__other__') setCustomSchoolName(''); }}
              size={Math.min(filteredSchools.length + 3, 8)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-400">
              <option value="">-- เลือกโรงเรียน --</option>
              {filteredSchools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="__other__">อื่นๆ (ระบุเอง)</option>
            </select>
            {isOtherSchool && (
              <input type="text" value={customSchoolName} onChange={e => setCustomSchoolName(e.target.value)}
                placeholder="กรุณาระบุชื่อโรงเรียน"
                className="w-full border-2 border-amber-300 rounded-lg px-4 py-2.5 text-base mt-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-amber-50" />
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">หมายเหตุ</label>
            <input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="รายละเอียดเพิ่มเติม"
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <button type="submit" disabled={saving}
            className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium px-6 py-3 rounded-lg transition">
            {saving ? 'กำลังบันทึก…' : 'บันทึกผลตรวจ'}
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-3 mb-4">
        <select value={resultFilter} onChange={e => setResultFilter(e.target.value)}
          className="border-2 border-gray-200 rounded-xl px-4 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-400">
          <option value="">ทุกผลตรวจ</option>
          {RESULT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-gray-400 py-10 text-center text-lg">กำลังโหลด…</p>
      ) : inspections.length === 0 ? (
        <p className="text-gray-400 py-10 text-center text-lg">ไม่มีบันทึกการตรวจ</p>
      ) : (
        <>
          {/* Desktop table */}
          <AppCard padding="none" className="hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-ink-muted text-xs font-semibold uppercase tracking-wide">
                <tr className="text-left">
                  <th className="px-4 py-3">ทะเบียนรถ</th>
                  <th className="px-4 py-3 text-center">ผลตรวจ</th>
                  <th className="px-4 py-3">วันที่ตรวจ</th>
                  <th className="px-4 py-3">หมดอายุ</th>
                  <th className="px-4 py-3">ผู้ตรวจ</th>
                  <th className="px-4 py-3">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {inspections.map(ins => (
                  <tr key={ins.id} className="hover:bg-surface transition">
                    <td className="px-4 py-3 font-medium text-gray-800">{ins.plate_no}</td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge variant={RESULT_VARIANT[ins.result] || 'neutral'} size="sm">
                        {RESULT_OPTIONS.find(o => o.value === ins.result)?.label || ins.result}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatThaiDate(ins.inspection_date)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatThaiDate(ins.expiry_date)}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{ins.inspector_name || '-'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{ins.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </AppCard>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {inspections.map(ins => (
              <div key={ins.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-base font-bold text-gray-900">{ins.plate_no}</p>
                  <StatusBadge variant={RESULT_VARIANT[ins.result] || 'neutral'} size="lg" className="shrink-0">
                    {RESULT_OPTIONS.find(o => o.value === ins.result)?.label || ins.result}
                  </StatusBadge>
                </div>
                <p className="text-sm text-gray-500">
                  ตรวจ: {formatThaiDate(ins.inspection_date)}
                  {ins.expiry_date && ` · หมดอายุ: ${formatThaiDate(ins.expiry_date)}`}
                </p>
                {ins.inspector_name && <p className="text-sm text-gray-400 mt-0.5">ผู้ตรวจ: {ins.inspector_name}</p>}
                {ins.notes && <p className="text-sm text-gray-400 mt-0.5">หมายเหตุ: {ins.notes}</p>}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
              <span>แสดง {inspections.length} จาก {meta.total}</span>
              <div className="flex gap-2">
                <button onClick={() => fetchInspections(meta.page - 1)} disabled={meta.page <= 1}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-30">ก่อนหน้า</button>
                <span className="px-3 py-2">{meta.page}/{totalPages}</span>
                <button onClick={() => fetchInspections(meta.page + 1)} disabled={meta.page >= totalPages}
                  className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-30">ถัดไป</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
