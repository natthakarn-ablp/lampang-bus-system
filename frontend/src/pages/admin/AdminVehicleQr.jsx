import { useState } from 'react';
import QRCode from 'qrcode';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

// Phase QR-1 — admin/transport tool: mint or rotate a vehicle's QR token, render
// + download/print the QR, and preview the staff (Level-3) view via the same
// public endpoint (the JWT is auto-injected by the api client → server returns L3).

export default function AdminVehicleQr() {
  const toast = useToast();
  const [vehicleId, setVehicleId] = useState('');
  const [token, setToken] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const scanUrl = token ? `${window.location.origin}/qr/${token}` : '';

  async function renderQr(url) {
    try { setQrDataUrl(await QRCode.toDataURL(url, { width: 256, margin: 1 })); } catch { setQrDataUrl(''); }
  }
  async function loadCurrent() {
    if (!vehicleId.trim()) return;
    setBusy(true); setPreview(null);
    try {
      const res = await api.get(`/qr/vehicle/${encodeURIComponent(vehicleId.trim())}/token`);
      const t = res.data.data.qr_token;
      setToken(t || '');
      if (t) renderQr(`${window.location.origin}/qr/${t}`); else setQrDataUrl('');
      if (t) loadPreview(t);
    } catch (err) { toast.error(err.response?.data?.message || 'ไม่พบรถ'); }
    finally { setBusy(false); }
  }
  async function generate() {
    if (!vehicleId.trim()) { toast.error('กรุณาระบุรหัสรถ'); return; }
    setBusy(true);
    try {
      const res = await api.post(`/qr/vehicle/${encodeURIComponent(vehicleId.trim())}/token`);
      const t = res.data.data.qr_token;
      setToken(t); renderQr(`${window.location.origin}/qr/${t}`); loadPreview(t);
      toast.success('สร้าง QR แล้ว');
    } catch (err) { toast.error(err.response?.data?.message || 'สร้างไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  async function loadPreview(t) {
    try { const res = await api.get(`/qr/vehicle/${encodeURIComponent(t)}`); setPreview(res.data.data); } catch { setPreview(null); }
  }
  function printQr() {
    if (!qrDataUrl) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>QR ${preview?.plate_no || ''}</title></head><body style="text-align:center;font-family:sans-serif;padding:40px">
      <h2>${preview?.plate_no || ''}</h2><img src="${qrDataUrl}" style="width:300px;height:300px"/><p style="color:#888;font-size:12px">${scanUrl}</p>
      <script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  return (
    <div className="p-3 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-800 mb-4">QR รถรับส่ง (สร้าง/พิมพ์)</h1>
      <div className="flex gap-2 mb-4">
        <input value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} placeholder="รหัสรถ (เช่น V-…)"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <button onClick={loadCurrent} disabled={busy} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 rounded-lg">ดูปัจจุบัน</button>
        <button onClick={generate} disabled={busy} className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 rounded-lg">สร้าง/หมุน QR</button>
      </div>

      {token && (
        <div className="bg-white border border-gray-100 rounded-xl p-5 flex flex-col items-center gap-3">
          {qrDataUrl && <img src={qrDataUrl} alt="QR" className="w-56 h-56" />}
          <code className="text-xs text-gray-500 break-all text-center">{scanUrl}</code>
          <button onClick={printQr} className="text-sm bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg">พิมพ์ QR</button>
        </div>
      )}

      {preview && (
        <div className="bg-white border border-gray-100 rounded-xl p-5 mt-4 text-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-gray-700">ตัวอย่างข้อมูล (ระดับ {preview.level})</span>
            {preview.level === 3 && <span className="text-xs text-amber-600">การเข้าถึงข้อมูลอ่อนไหวนี้ถูกบันทึก</span>}
          </div>
          <div className="text-gray-600 space-y-1">
            <div>ทะเบียน: <b>{preview.plate_no}</b></div>
            <div>ตรวจสภาพ: {preview.inspection_status} · ประกัน: {preview.insurance_status} · คนขับ: {preview.driver_status}</div>
            {preview.level >= 2 && <div>คนขับ: {preview.driver_name || '—'} · ติดต่อ: {preview.driver_phone || preview.emergency_contact || '—'}</div>}
            {preview.level === 3 && (
              <div className="mt-1">ประวัติเสี่ยง: {preview.level3_enabled ? `${(preview.risk_history || []).length} รายการ` : 'ปิดใช้งาน (รอ DPO)'}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
