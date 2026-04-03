import { useState, useEffect } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

const VEHICLE_TYPE_OPTIONS = [
  'รถตู้',
  'รถบัส',
  'รถกระบะ',
  'รถยนต์นั่งส่วนบุคคล',
  'รถยนต์อเนกประสงค์',
  'รถจักรยานยนต์',
];

const INSURANCE_STATUS_OPTIONS = [
  { value: 'คุ้มครองปกติ', label: 'คุ้มครองปกติ' },
  { value: 'ใกล้หมดอายุ', label: 'ใกล้หมดอายุ' },
  { value: 'หมดอายุ', label: 'หมดอายุ' },
  { value: 'อยู่ระหว่างรอต่ออายุ', label: 'อยู่ระหว่างรอต่ออายุ' },
  { value: 'ยกเลิกกรมธรรม์', label: 'ยกเลิกกรมธรรม์' },
];

const INSURANCE_TYPE_OPTIONS = [
  'พ.ร.บ.',
  'ประกันภัยชั้น 1',
  'ประกันภัยชั้น 2+',
  'ประกันภัยชั้น 2',
  'ประกันภัยชั้น 3+',
  'ประกันภัยชั้น 3',
];

function isKnownVehicleType(val) {
  return !val || VEHICLE_TYPE_OPTIONS.includes(val);
}

export default function DriverProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [vehicleTypeOther, setVehicleTypeOther] = useState('');
  const [isOtherType, setIsOtherType] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showPwdForm, setShowPwdForm] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [pwdSaving, setPwdSaving] = useState(false);
  const toast = useToast();

  function initForm(p) {
    const vt = p.vehicle_type || '';
    const known = isKnownVehicleType(vt);
    setIsOtherType(!known);
    setVehicleTypeOther(known ? '' : vt);
    setForm({
      name: p.name || '',
      phone: p.phone || '',
      vehicle_type: known ? vt : '__OTHER__',
      attendant_name: p.attendant_name || '',
      attendant_phone: p.attendant_phone || '',
      owner_name: p.owner_name || '',
      owner_phone: p.owner_phone || '',
      insurance_type: p.insurance_type || '',
      insurance_status: p.insurance_status || '',
      insurance_expiry: p.insurance_expiry ? p.insurance_expiry.split('T')[0] : '',
    });
  }

  useEffect(() => {
    api.get('/driver/profile')
      .then((res) => {
        setProfile(res.data.data);
        initForm(res.data.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function validatePhones() {
    for (const field of ['phone', 'attendant_phone', 'owner_phone']) {
      const val = form[field];
      if (val && !/^\d{9,10}$/.test(val)) {
        const labels = { phone: 'เบอร์โทรคนขับ', attendant_phone: 'เบอร์โทรผู้ดูแลรถ', owner_phone: 'เบอร์โทรผู้ครอบครอง' };
        toast.error(`${labels[field]}ต้องเป็นตัวเลข 9-10 หลัก`);
        return false;
      }
    }
    return true;
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error('กรุณากรอกชื่อคนขับ'); return; }
    if (!validatePhones()) return;

    // Resolve vehicle type
    const resolvedVehicleType = form.vehicle_type === '__OTHER__'
      ? vehicleTypeOther.trim()
      : form.vehicle_type;

    if (form.vehicle_type === '__OTHER__' && !vehicleTypeOther.trim()) {
      toast.error('กรุณาระบุประเภทรถ');
      return;
    }

    setSaving(true);
    try {
      await api.put('/driver/profile', { ...form, vehicle_type: resolvedVehicleType });
      toast.success('อัปเดตข้อมูลสำเร็จ');
      setEditing(false);
      const updatedProfile = { ...profile, ...form, vehicle_type: resolvedVehicleType };
      setProfile(updatedProfile);
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถบันทึกได้');
    } finally { setSaving(false); }
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('ไฟล์ต้องไม่เกิน 2 MB'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      const res = await api.post('/driver/profile/photo', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('อัปโหลดรูปสำเร็จ');
      setProfile((p) => ({ ...p, photo_url: res.data.data.photo_url }));
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถอัปโหลดรูปได้');
    } finally { setUploading(false); }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    if (pwdForm.new_password.length < 4) { toast.error('รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร'); return; }
    if (pwdForm.new_password !== pwdForm.confirm_password) { toast.error('รหัสผ่านใหม่ไม่ตรงกัน'); return; }
    setPwdSaving(true);
    try {
      await api.post('/driver/change-password', {
        current_password: pwdForm.current_password,
        new_password: pwdForm.new_password,
      });
      toast.success('เปลี่ยนรหัสผ่านสำเร็จ');
      setShowPwdForm(false);
      setPwdForm({ current_password: '', new_password: '', confirm_password: '' });
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถเปลี่ยนรหัสผ่านได้');
    } finally { setPwdSaving(false); }
  }

  if (loading) return <p className="p-6 text-center text-gray-400">กำลังโหลด…</p>;
  if (!profile) return (
    <div className="p-6 text-center">
      <p className="text-gray-400 text-base">ไม่พบข้อมูลโปรไฟล์</p>
      <p className="text-xs text-gray-300 mt-1">กรุณาลองรีเฟรชหน้าจอ</p>
    </div>
  );

  const expiryDisplay = profile.insurance_expiry
    ? new Date(profile.insurance_expiry).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
    : '-';

  const infoSections = [
    {
      title: 'ข้อมูลรถ',
      rows: [
        { label: 'ทะเบียนรถ', value: profile.plate_no, highlight: true },
        { label: 'ประเภทรถ', value: profile.vehicle_type },
      ],
    },
    {
      title: 'ข้อมูลคนขับ',
      rows: [
        { label: 'ชื่อคนขับ', value: profile.name },
        { label: 'เบอร์โทรคนขับ', value: profile.phone },
      ],
    },
    {
      title: 'ข้อมูลผู้ดูแลรถ',
      rows: [
        { label: 'ชื่อผู้ดูแลรถ', value: profile.attendant_name },
        { label: 'เบอร์โทรผู้ดูแลรถ', value: profile.attendant_phone },
      ],
    },
    {
      title: 'ข้อมูลผู้ครอบครองรถ',
      rows: [
        { label: 'ชื่อผู้ครอบครองรถ', value: profile.owner_name },
        { label: 'เบอร์โทรผู้ครอบครอง', value: profile.owner_phone },
      ],
    },
    {
      title: 'ประกันภัย',
      rows: [
        { label: 'สถานะประกัน', value: profile.insurance_status },
        { label: 'ประเภทประกัน', value: profile.insurance_type },
        { label: 'วันหมดอายุ', value: expiryDisplay },
      ],
    },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-gray-800">ข้อมูลคนขับและรถ</h1>

      {/* Photo */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col items-center gap-3">
        {profile.photo_url ? (
          <img src={profile.photo_url} alt="รูปคนขับ"
            className="w-28 h-28 rounded-full object-cover border-2 border-gray-200 shadow-sm"
            onError={(e) => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex'; }}
          />
        ) : null}
        <div className={`w-28 h-28 rounded-full bg-gray-100 items-center justify-center text-gray-300 border-2 border-gray-200 ${profile.photo_url ? 'hidden' : 'flex'}`}>
          <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
        </div>
        <label className={`text-sm px-4 py-2 rounded-lg border transition cursor-pointer ${uploading ? 'opacity-50 cursor-not-allowed' : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'}`}>
          {uploading ? 'กำลังอัปโหลด…' : 'เปลี่ยนรูป'}
          <input type="file" accept=".jpg,.jpeg,.png,.webp" onChange={handlePhotoUpload} className="hidden" disabled={uploading} />
        </label>
        <p className="text-xs text-gray-400">JPG, PNG, WebP ไม่เกิน 2 MB</p>
      </div>

      {/* Info display (read-only mode) */}
      {!editing && (
        <>
          {infoSections.map(section => (
            <div key={section.title} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{section.title}</p>
              </div>
              <div className="divide-y divide-gray-100">
                {section.rows.map(({ label, value, highlight }) => (
                  <div key={label} className="flex justify-between px-5 py-3 text-sm">
                    <span className="text-gray-500">{label}</span>
                    <span className={`font-medium ${highlight ? 'text-blue-700' : 'text-gray-800'}`}>{value || '-'}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <button onClick={() => setEditing(true)}
            className="w-full sm:w-auto bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium px-5 py-2.5 rounded-lg border border-blue-200 transition">
            แก้ไขข้อมูล
          </button>
        </>
      )}

      {/* Edit mode */}
      {editing && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
          <h2 className="text-sm font-semibold text-gray-700">แก้ไขข้อมูลทั้งหมด</h2>
          <p className="text-xs text-gray-400">ทะเบียนรถไม่สามารถแก้ไขได้จากหน้านี้</p>

          {/* Driver */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ข้อมูลคนขับ</legend>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="ชื่อคนขับ" value={form.name} required
                onChange={(v) => setForm({ ...form, name: v })} />
              <FormField label="เบอร์โทรคนขับ" value={form.phone} type="tel" maxLength={10}
                onChange={(v) => setForm({ ...form, phone: v.replace(/\D/g, '') })} />
            </div>
          </fieldset>

          {/* Vehicle */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ข้อมูลรถ</legend>
            <div>
              <label className="block text-sm text-gray-600 mb-1">ประเภทรถ</label>
              <select
                value={form.vehicle_type}
                onChange={(e) => {
                  const val = e.target.value;
                  setForm({ ...form, vehicle_type: val });
                  setIsOtherType(val === '__OTHER__');
                  if (val !== '__OTHER__') setVehicleTypeOther('');
                }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">— เลือกประเภทรถ —</option>
                {VEHICLE_TYPE_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                <option value="__OTHER__">อื่นๆ</option>
              </select>
            </div>
            {isOtherType && (
              <div>
                <label className="block text-sm text-gray-600 mb-1">ระบุประเภทรถ</label>
                <input type="text" value={vehicleTypeOther}
                  onChange={(e) => setVehicleTypeOther(e.target.value)}
                  placeholder="กรอกประเภทรถ"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
            )}
          </fieldset>

          {/* Attendant */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ผู้ดูแลรถ</legend>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="ชื่อผู้ดูแลรถ" value={form.attendant_name}
                onChange={(v) => setForm({ ...form, attendant_name: v })} />
              <FormField label="เบอร์โทรผู้ดูแลรถ" value={form.attendant_phone} type="tel" maxLength={10}
                onChange={(v) => setForm({ ...form, attendant_phone: v.replace(/\D/g, '') })} />
            </div>
          </fieldset>

          {/* Owner */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ผู้ครอบครองรถ</legend>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="ชื่อผู้ครอบครอง" value={form.owner_name}
                onChange={(v) => setForm({ ...form, owner_name: v })} />
              <FormField label="เบอร์โทรผู้ครอบครอง" value={form.owner_phone} type="tel" maxLength={10}
                onChange={(v) => setForm({ ...form, owner_phone: v.replace(/\D/g, '') })} />
            </div>
          </fieldset>

          {/* Insurance */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ประกันภัย</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">สถานะประกันภัย</label>
                <select value={form.insurance_status}
                  onChange={(e) => setForm({ ...form, insurance_status: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">— เลือกสถานะ —</option>
                  {INSURANCE_STATUS_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">ประเภทประกัน</label>
                <select value={form.insurance_type}
                  onChange={(e) => setForm({ ...form, insurance_type: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">— เลือกประเภท —</option>
                  {INSURANCE_TYPE_OPTIONS.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
            </div>
            <FormField label="วันหมดอายุประกัน" value={form.insurance_expiry} type="date"
              onChange={(v) => setForm({ ...form, insurance_expiry: v })} />
          </fieldset>

          <div className="flex gap-3 pt-2">
            <button onClick={handleSave} disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition">
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
            <button onClick={() => { setEditing(false); initForm(profile); }}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm px-5 py-2.5 rounded-lg transition">ยกเลิก</button>
          </div>
        </div>
      )}

      {/* Change password */}
      {showPwdForm ? (
        <form onSubmit={handleChangePassword} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">เปลี่ยนรหัสผ่าน</h2>
          <FormField label="รหัสผ่านเดิม" value={pwdForm.current_password} type="password" required
            onChange={(v) => setPwdForm({ ...pwdForm, current_password: v })} />
          <FormField label="รหัสผ่านใหม่" value={pwdForm.new_password} type="password" required minLength={4}
            onChange={(v) => setPwdForm({ ...pwdForm, new_password: v })} />
          <div>
            <FormField label="ยืนยันรหัสผ่านใหม่" value={pwdForm.confirm_password} type="password" required minLength={4}
              onChange={(v) => setPwdForm({ ...pwdForm, confirm_password: v })} />
            {pwdForm.confirm_password && pwdForm.new_password !== pwdForm.confirm_password && (
              <p className="text-xs text-red-500 mt-1">รหัสผ่านใหม่ไม่ตรงกัน</p>
            )}
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={pwdSaving}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition">
              {pwdSaving ? 'กำลังเปลี่ยน…' : 'เปลี่ยนรหัสผ่าน'}
            </button>
            <button type="button" onClick={() => { setShowPwdForm(false); setPwdForm({ current_password: '', new_password: '', confirm_password: '' }); }}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm px-5 py-2.5 rounded-lg transition">ยกเลิก</button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowPwdForm(true)}
          className="w-full sm:w-auto bg-gray-50 hover:bg-gray-100 text-gray-600 text-sm px-5 py-2.5 rounded-lg border border-gray-200 transition">
          เปลี่ยนรหัสผ่าน
        </button>
      )}
    </div>
  );
}

function FormField({ label, value, onChange, type = 'text', required, minLength, maxLength }) {
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        required={required} minLength={minLength} maxLength={maxLength}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
    </div>
  );
}
