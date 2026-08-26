import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bus, Pencil } from 'lucide-react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import { VehicleSafetySection } from '../../components/VehicleSafety';
import PlateSearchInput from '../../components/PlateSearchInput';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';

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

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold text-gray-800">รถรับส่ง</h1>
        <PlateSearchInput value={plateSearch} onChange={setPlateSearch} suggestions={vehicles} />
      </div>

      {error && <ErrorState message={error} className="mb-4" />}

      {loading ? (
        <LoadingState />
      ) : vehicles.length === 0 ? (
        <EmptyState icon={Bus} title="ไม่มีรถรับส่ง" description={plateSearch ? 'ลองค้นด้วยทะเบียนอื่น' : 'ยังไม่มีรถในระบบ'} />
      ) : (
        <div className="grid gap-4">
          {vehicles
            .filter(v => !plateSearch || v.plate_no.toLowerCase().includes(plateSearch.toLowerCase()))
            .map((v) => (
            <div
              key={`${v.id}-${v.driver_name || ''}-${v.attendant_name || ''}`}
              className="bg-white rounded-xl border border-gray-200 p-5"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-800">{v.plate_no}</h3>
                  <p className="text-xs text-gray-500">{v.vehicle_type || 'ไม่ระบุประเภท'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium bg-blue-50 text-blue-700 px-3 py-1 rounded-full">
                    {v.student_count} คน
                  </span>
                  <button
                    type="button"
                    onClick={() => openEdit(v)}
                    className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
                  >
                    <Pencil className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden="true" />
                    แก้ไขข้อมูลรถ
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                {/* Driver */}
                <div className="flex items-start gap-2">
                  {v.driver_photo ? (
                    <img src={`/uploads/drivers/${v.driver_photo}`} alt="" className="w-10 h-10 rounded-full object-cover shrink-0 border border-gray-200" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-lg shrink-0">👤</div>
                  )}
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">คนขับ</p>
                    <p className="text-gray-700 font-medium">{v.driver_name || '-'}</p>
                    {v.driver_phone && (
                      <a href={`tel:${v.driver_phone}`} className="text-blue-600 hover:underline text-xs">{v.driver_phone}</a>
                    )}
                  </div>
                </div>

                {/* Attendant */}
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">ผู้ดูแลรถ</p>
                  <p className="text-gray-700">{v.attendant_name || '-'}</p>
                  {v.attendant_phone && (
                    <p className="text-xs text-gray-400">{v.attendant_phone}</p>
                  )}
                </div>

                {/* Owner */}
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">เจ้าของรถ</p>
                  <p className="text-gray-700">{v.owner_name || '-'}</p>
                  {v.owner_phone && (
                    <p className="text-xs text-gray-400">{v.owner_phone}</p>
                  )}
                </div>

              </div>

              {/* Safety: inspection + insurance */}
              <VehicleSafetySection vehicle={v} />

              {/* Collapsible student list */}
              <button
                onClick={async () => {
                  if (expandedVehicle === v.id) { setExpandedVehicle(null); return; }
                  setExpandedVehicle(v.id);
                  if (!studentCache[v.id]) {
                    try {
                      const res = await api.get(`/school/students?vehicle_id=${v.id}&per_page=100`);
                      setStudentCache(c => ({ ...c, [v.id]: res.data.data }));
                    } catch {}
                  }
                }}
                className="mt-3 text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                {expandedVehicle === v.id ? '▲ ซ่อนรายชื่อนักเรียน' : '▼ แสดงรายชื่อนักเรียน'}
              </button>

              {expandedVehicle === v.id && studentCache[v.id] && (
                <div className="mt-2 border-t border-gray-100 pt-2 overflow-x-auto">
                  {studentCache[v.id].length === 0 ? (
                    <p className="text-xs text-gray-400 py-2">ไม่มีนักเรียน</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="text-ink-muted text-[10px] font-semibold uppercase tracking-wide">
                        <tr className="text-left">
                          <th className="py-1.5 pr-3">ชื่อ-นามสกุล</th>
                          <th className="py-1.5 pr-3">ชั้น/ห้อง</th>
                          <th className="py-1.5 pr-3">ผู้ปกครอง</th>
                          <th className="py-1.5">เบอร์โทร</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-surface-border">
                        {studentCache[v.id].map(s => (
                          <tr key={s.id}>
                            <td className="py-1.5 pr-3 text-gray-700">{s.prefix}{s.first_name} {s.last_name}</td>
                            <td className="py-1.5 pr-3 text-gray-500">{s.grade && s.classroom ? `${s.grade}/${s.classroom}` : s.grade || '-'}</td>
                            <td className="py-1.5 pr-3 text-gray-600">{s.parent_name || '-'}</td>
                            <td className="py-1.5 text-gray-400">{s.parent_phone || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ─── Edit vehicle modal ────────────────────────────────────────── */}
      {editVehicle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditVehicle(null)}>
          <form
            onSubmit={handleSaveEdit}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl max-h-[90vh] overflow-y-auto"
          >
            <h3 className="text-base font-bold text-gray-800">แก้ไขข้อมูลรถ</h3>
            <p className="mt-0.5 text-sm text-gray-500">{editVehicle.plate_no}</p>

            <div className="mt-4 space-y-3 text-sm">
              <div>
                <label className="block text-gray-600 mb-1">ประเภทรถ</label>
                <input value={editForm.vehicle_type}
                  onChange={e => setEditForm(f => ({ ...f, vehicle_type: e.target.value }))}
                  placeholder="เช่น รถตู้ / รถสองแถว"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-600 mb-1">ชื่อเจ้าของรถ</label>
                  <input value={editForm.owner_name}
                    onChange={e => setEditForm(f => ({ ...f, owner_name: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">เบอร์เจ้าของรถ</label>
                  <input value={editForm.owner_phone}
                    onChange={e => setEditForm(f => ({ ...f, owner_phone: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-gray-600 mb-1">สถานะประกัน</label>
                  <input value={editForm.insurance_status}
                    onChange={e => setEditForm(f => ({ ...f, insurance_status: e.target.value }))}
                    placeholder="เช่น มีประกัน / หมดอายุ"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-gray-600 mb-1">ประเภทประกัน</label>
                  <input value={editForm.insurance_type}
                    onChange={e => setEditForm(f => ({ ...f, insurance_type: e.target.value }))}
                    placeholder="เช่น ชั้น 1 / พ.ร.บ."
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
              </div>
              <div>
                <label className="block text-gray-600 mb-1">วันหมดอายุประกัน</label>
                <input type="date" value={editForm.insurance_expiry}
                  onChange={e => setEditForm(f => ({ ...f, insurance_expiry: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <p className="text-xs text-gray-400">ข้อมูลคนขับ ให้คนขับแก้ไขเองในหน้าโปรไฟล์คนขับ</p>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setEditVehicle(null)}
                className="text-sm font-medium px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition">
                ยกเลิก
              </button>
              <button type="submit" disabled={savingEdit}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition">
                {savingEdit ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
