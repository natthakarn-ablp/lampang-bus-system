import { useState } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

const EMPTY_ROW = { plate_no: '', vehicle_type: 'รถตู้', driver_name: '', driver_phone: '' };

export default function SchoolBulkVehicles() {
  const [rows, setRows] = useState([{ ...EMPTY_ROW }]);
  const [saving, setSaving] = useState(false);
  const [existingVehicles, setExistingVehicles] = useState([]);
  const [searchPlate, setSearchPlate] = useState('');
  const toast = useToast();

  function addRow() {
    if (rows.length >= 10) { toast.error('สูงสุด 10 คันต่อครั้ง'); return; }
    setRows([...rows, { ...EMPTY_ROW }]);
  }

  function removeRow(i) {
    setRows(rows.filter((_, idx) => idx !== i));
  }

  function updateRow(i, field, value) {
    setRows(rows.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  }

  async function searchExisting() {
    if (!searchPlate.trim()) return;
    try {
      // Use province vehicles endpoint to find province-wide (if user has access, otherwise backend scopes it)
      const res = await api.get(`/school/vehicles`);
      const found = res.data.data.filter(v => v.plate_no.toLowerCase().includes(searchPlate.toLowerCase()));
      setExistingVehicles(found);
    } catch { setExistingVehicles([]); }
  }

  function selectExisting(v) {
    if (rows.length >= 10) { toast.error('สูงสุด 10 คันต่อครั้ง'); return; }
    setRows([...rows, { plate_no: v.plate_no, vehicle_type: v.vehicle_type || 'รถตู้', driver_name: v.driver_name || '', driver_phone: v.driver_phone || '', existing_id: v.id }]);
    setExistingVehicles([]);
    setSearchPlate('');
  }

  async function handleSave() {
    const valid = rows.filter(r => r.plate_no.trim());
    if (valid.length === 0) { toast.error('กรุณากรอกทะเบียนรถอย่างน้อย 1 คัน'); return; }

    setSaving(true);
    let ok = 0, fail = 0;
    for (const row of valid) {
      try {
        await api.post('/school/vehicles', {
          plate_no: row.plate_no.trim(),
          vehicle_type: row.vehicle_type,
          driver_name: row.driver_name.trim(),
          driver_phone: row.driver_phone.trim(),
        });
        ok++;
      } catch {
        fail++;
      }
    }
    toast.success(`บันทึกสำเร็จ ${ok} คัน${fail > 0 ? ` · ล้มเหลว ${fail} คัน` : ''}`);
    setSaving(false);
    if (ok > 0) setRows([{ ...EMPTY_ROW }]);
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-1">เพิ่มรถรับส่ง</h1>
      <p className="text-sm text-gray-500 mb-4">เพิ่มได้สูงสุด 10 คันต่อครั้ง · เฉพาะโรงเรียนของตนเอง</p>

      {/* Search existing vehicle */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <p className="text-sm font-medium text-gray-600 mb-2">ค้นหารถที่มีอยู่แล้วในระบบ</p>
        <div className="flex gap-2">
          <input type="text" value={searchPlate} onChange={(e) => setSearchPlate(e.target.value)}
            placeholder="พิมพ์ทะเบียนรถ…"
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <button onClick={searchExisting}
            className="bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm px-4 py-2 rounded-lg border border-blue-200 transition">ค้นหา</button>
        </div>
        {existingVehicles.length > 0 && (
          <div className="mt-2 space-y-1">
            {existingVehicles.map(v => (
              <button key={v.id} onClick={() => selectExisting(v)}
                className="w-full text-left text-sm px-3 py-2 bg-gray-50 hover:bg-blue-50 rounded-lg border border-gray-100 transition">
                {v.plate_no} — {v.driver_name || 'ไม่ระบุคนขับ'} ({v.student_count} คน)
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Vehicle rows */}
      <div className="space-y-3 mb-4">
        {rows.map((r, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-600">คันที่ {i + 1}</span>
              {rows.length > 1 && (
                <button onClick={() => removeRow(i)} className="text-xs text-red-500 hover:text-red-700">ลบ</button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">ทะเบียนรถ *</label>
                <input type="text" value={r.plate_no} onChange={(e) => updateRow(i, 'plate_no', e.target.value)}
                  placeholder="เช่น นข 2210 ลำปาง"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">ประเภทรถ</label>
                <select value={r.vehicle_type} onChange={(e) => updateRow(i, 'vehicle_type', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="รถตู้">รถตู้</option>
                  <option value="รถสองแถว">รถสองแถว</option>
                  <option value="รถบัส">รถบัส</option>
                  <option value="อื่นๆ">อื่นๆ</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">ชื่อคนขับ</label>
                <input type="text" value={r.driver_name} onChange={(e) => updateRow(i, 'driver_name', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">เบอร์โทรคนขับ</label>
                <input type="text" value={r.driver_phone} onChange={(e) => updateRow(i, 'driver_phone', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        {rows.length < 10 && (
          <button onClick={addRow}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium px-5 py-2 rounded-lg transition">
            + เพิ่มอีกคัน
          </button>
        )}
        <button onClick={handleSave} disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition">
          {saving ? 'กำลังบันทึก…' : `บันทึก ${rows.filter(r => r.plate_no.trim()).length} คัน`}
        </button>
      </div>
    </div>
  );
}
