import { useState } from 'react';
import { QrCode, Printer, ShieldAlert } from 'lucide-react';
import QRCode from 'qrcode';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import { AppCard, AlertBanner, FormField, SectionTitle, StatusBadge } from '../../components/ui';

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
  // The preview fetch failed silently, leaving the last vehicle's details on
  // screen beside a newly minted QR for a different vehicle.
  const [previewError, setPreviewError] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const scanUrl = token ? `${window.location.origin}/qr/${token}` : '';

  async function renderQr(url) {
    try { setQrDataUrl(await QRCode.toDataURL(url, { width: 256, margin: 1 })); } catch { setQrDataUrl(''); }
  }
  async function loadCurrent() {
    if (!vehicleId.trim()) { toast.error('กรุณาระบุรหัสรถ'); return; }
    setBusy(true); setPreview(null); setPreviewError(null); setSearched(true);
    try {
      const res = await api.get(`/qr/vehicle/${encodeURIComponent(vehicleId.trim())}/token`);
      const t = res.data.data.qr_token;
      setToken(t || '');
      if (t) { renderQr(`${window.location.origin}/qr/${t}`); loadPreview(t); }
      else setQrDataUrl('');
    } catch (err) { toast.error(err.response?.data?.message || 'ไม่พบรถ'); }
    finally { setBusy(false); }
  }
  async function generate() {
    if (!vehicleId.trim()) { toast.error('กรุณาระบุรหัสรถ'); return; }
    setBusy(true); setSearched(true);
    try {
      const res = await api.post(`/qr/vehicle/${encodeURIComponent(vehicleId.trim())}/token`);
      const t = res.data.data.qr_token;
      setToken(t); renderQr(`${window.location.origin}/qr/${t}`); loadPreview(t);
      toast.success('สร้าง QR แล้ว');
    } catch (err) { toast.error(err.response?.data?.message || 'สร้างไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  async function loadPreview(t) {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await api.get(`/qr/vehicle/${encodeURIComponent(t)}`);
      setPreview(res.data.data);
    } catch (err) {
      setPreview(null);
      setPreviewError(err.response?.data?.message || 'โหลดตัวอย่างข้อมูลไม่สำเร็จ');
    } finally {
      setPreviewLoading(false);
    }
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
    <div className="p-3 sm:p-6 max-w-2xl mx-auto pb-10">
      <PageHeader
        icon={QrCode}
        title="QR รถรับส่ง (สร้าง/พิมพ์)"
        subtitle="สร้างหรือหมุน QR ประจำรถ แล้วพิมพ์ติดในรถ — การหมุนจะทำให้ QR เดิมใช้ไม่ได้ทันที"
      />

      <AppCard padding="md" className="mb-4">
        <form
          onSubmit={e => { e.preventDefault(); loadCurrent(); }}
          className="flex flex-col sm:flex-row sm:items-end gap-2"
        >
          <FormField
            label="รหัสรถ"
            className="flex-1 min-w-0"
            value={vehicleId}
            onChange={setVehicleId}
            placeholder="เช่น V-001"
            helper="รหัสรถในระบบ ไม่ใช่เลขทะเบียน"
          />
          <div className="flex gap-2 shrink-0">
            <button
              type="submit"
              disabled={busy}
              className="focus-ring text-sm font-medium bg-surface hover:bg-surface-border text-ink border border-surface-border px-4 min-h-[44px] rounded-lg transition disabled:opacity-50 disabled:pointer-events-none"
            >
              ดูปัจจุบัน
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={busy}
              className="focus-ring text-sm font-semibold bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white px-4 min-h-[44px] rounded-lg transition disabled:opacity-50 disabled:pointer-events-none"
            >
              สร้าง/หมุน QR
            </button>
          </div>
        </form>
      </AppCard>

      {busy ? (
        <LoadingState message="กำลังทำงาน…" />
      ) : token ? (
        <AppCard padding="md" className="flex flex-col items-center gap-3">
          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt={`QR สำหรับรถ ${preview?.plate_no || vehicleId}`}
              className="w-56 h-56"
            />
          )}
          <code className="text-caption text-ink-muted break-all text-center">{scanUrl}</code>
          <button
            type="button"
            onClick={printQr}
            className="focus-ring inline-flex items-center gap-1.5 text-sm font-semibold bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white px-4 min-h-[44px] rounded-lg transition"
          >
            <Printer className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
            พิมพ์ QR
          </button>
        </AppCard>
      ) : searched ? (
        <EmptyState icon={QrCode} title="รถคันนี้ยังไม่มี QR" description='กด "สร้าง/หมุน QR" เพื่อสร้างใหม่' />
      ) : null}

      {(previewLoading || previewError || preview) && (
        <AppCard padding="md" className="mt-4">
          {previewLoading ? (
            <LoadingState compact message="กำลังโหลดตัวอย่างข้อมูล…" />
          ) : previewError ? (
            <AlertBanner variant="danger" title="โหลดตัวอย่างข้อมูลไม่สำเร็จ">{previewError}</AlertBanner>
          ) : (
            <>
              <SectionTitle title={`ตัวอย่างข้อมูล (ระดับ ${preview.level})`} className="mb-2" />
              {preview.level === 3 && (
                <p className="mb-2 inline-flex items-start gap-1.5 text-caption text-warn-ink font-medium">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-px" strokeWidth={2.2} aria-hidden="true" />
                  การเข้าถึงข้อมูลอ่อนไหวนี้ถูกบันทึก
                </p>
              )}
              <dl className="text-sm text-ink-muted space-y-1.5">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-ink">ทะเบียน:</dt>
                  <dd className="font-semibold text-ink">{preview.plate_no}</dd>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <dt className="font-medium text-ink">สถานะ:</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    <StatusBadge size="sm" variant="neutral">ตรวจสภาพ: {preview.inspection_status}</StatusBadge>
                    <StatusBadge size="sm" variant="neutral">ประกัน: {preview.insurance_status}</StatusBadge>
                    <StatusBadge size="sm" variant="neutral">คนขับ: {preview.driver_status}</StatusBadge>
                  </dd>
                </div>
                {preview.level >= 2 && (
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="font-medium text-ink">คนขับ:</dt>
                    <dd>
                      {preview.driver_name || '—'} · ติดต่อ: {preview.driver_phone || preview.emergency_contact || '—'}
                    </dd>
                  </div>
                )}
                {preview.level === 3 && (
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="font-medium text-ink">ประวัติเสี่ยง:</dt>
                    <dd>
                      {preview.level3_enabled
                        ? `${(preview.risk_history || []).length} รายการ`
                        : 'ปิดใช้งาน (รอ DPO)'}
                    </dd>
                  </div>
                )}
              </dl>
            </>
          )}
        </AppCard>
      )}
    </div>
  );
}
