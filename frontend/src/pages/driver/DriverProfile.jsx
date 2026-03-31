import { useState, useEffect } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

export default function DriverProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showPwdForm, setShowPwdForm] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current_password: '', new_password: '' });
  const [pwdSaving, setPwdSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.get('/driver/profile')
      .then((res) => {
        setProfile(res.data.data);
        setForm({ name: res.data.data.name || '', phone: res.data.data.phone || '' });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await api.put('/driver/profile', form);
      toast.success('อัปเดตข้อมูลสำเร็จ');
      setEditing(false);
      setProfile((p) => ({ ...p, ...form }));
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถบันทึกได้');
    } finally { setSaving(false); }
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
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
    setPwdSaving(true);
    try {
      await api.post('/driver/change-password', pwdForm);
      toast.success('เปลี่ยนรหัสผ่านสำเร็จ');
      setShowPwdForm(false);
      setPwdForm({ current_password: '', new_password: '' });
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สามารถเปลี่ยนรหัสผ่านได้');
    } finally { setPwdSaving(false); }
  }

  if (loading) return <p className="p-6 text-center text-gray-400">กำลังโหลด…</p>;
  if (!profile) return <p className="p-6 text-center text-gray-400">ไม่พบข้อมูล</p>;

  const info = [
    { label: 'ทะเบียนรถ', value: profile.plate_no },
    { label: 'ประเภทรถ', value: profile.vehicle_type || '-' },
    { label: 'ชื่อคนขับ', value: profile.name },
    { label: 'เบอร์โทรคนขับ', value: profile.phone || '-' },
    { label: 'ชื่อผู้ดูแลรถ', value: profile.attendant_name || '-' },
    { label: 'เบอร์โทรผู้ดูแลรถ', value: profile.attendant_phone || '-' },
    { label: 'ชื่อผู้ครอบครองรถ', value: profile.owner_name || '-' },
    { label: 'เบอร์โทรผู้ครอบครอง', value: profile.owner_phone || '-' },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-4">ข้อมูลคนขับและรถ</h1>

      {/* Photo */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4 flex flex-col items-center gap-3">
        {profile.photo_url ? (
          <img src={profile.photo_url} alt="รูปคนขับ" className="w-24 h-24 rounded-full object-cover border-2 border-gray-200" />
        ) : (
          <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center text-3xl text-gray-400">👤</div>
        )}
        <label className={`text-sm px-4 py-2 rounded-lg border transition cursor-pointer ${uploading ? 'opacity-50' : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'}`}>
          {uploading ? 'กำลังอัปโหลด…' : 'เปลี่ยนรูป'}
          <input type="file" accept=".jpg,.jpeg,.png,.webp" onChange={handlePhotoUpload} className="hidden" disabled={uploading} />
        </label>
      </div>

      {/* Info table */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 mb-4">
        {info.map(({ label, value }) => (
          <div key={label} className="flex justify-between px-5 py-3 text-sm">
            <span className="text-gray-500">{label}</span>
            <span className="text-gray-800 font-medium">{value}</span>
          </div>
        ))}
      </div>

      {/* Edit profile */}
      <div className="mb-4">
        {editing ? (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-600">แก้ไขข้อมูลคนขับ</h2>
            <div>
              <label className="block text-sm text-gray-600 mb-1">ชื่อ</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">เบอร์โทร</label>
              <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <p className="text-xs text-gray-400">หมายเหตุ: คนขับสามารถแก้ไขได้เฉพาะชื่อและเบอร์โทรของตนเอง ข้อมูลอื่นๆ ต้องแจ้งโรงเรียน</p>
            <div className="flex gap-3">
              <button onClick={handleSave} disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition">
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
              <button onClick={() => setEditing(false)}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm px-5 py-2 rounded-lg transition">ยกเลิก</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setEditing(true)}
            className="bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium px-5 py-2 rounded-lg border border-blue-200 transition">
            แก้ไขข้อมูล
          </button>
        )}
      </div>

      {/* Change password */}
      <div>
        {showPwdForm ? (
          <form onSubmit={handleChangePassword} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-600">เปลี่ยนรหัสผ่าน</h2>
            <div>
              <label className="block text-sm text-gray-600 mb-1">รหัสผ่านเดิม</label>
              <input type="password" value={pwdForm.current_password}
                onChange={(e) => setPwdForm({ ...pwdForm, current_password: e.target.value })} required
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">รหัสผ่านใหม่</label>
              <input type="password" value={pwdForm.new_password}
                onChange={(e) => setPwdForm({ ...pwdForm, new_password: e.target.value })} required minLength={4}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={pwdSaving}
                className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition">
                {pwdSaving ? 'กำลังเปลี่ยน…' : 'เปลี่ยนรหัสผ่าน'}
              </button>
              <button type="button" onClick={() => setShowPwdForm(false)}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm px-5 py-2 rounded-lg transition">ยกเลิก</button>
            </div>
          </form>
        ) : (
          <button onClick={() => setShowPwdForm(true)}
            className="bg-gray-50 hover:bg-gray-100 text-gray-600 text-sm px-5 py-2 rounded-lg border border-gray-200 transition">
            เปลี่ยนรหัสผ่าน
          </button>
        )}
      </div>
    </div>
  );
}
