import { useState, useEffect } from 'react';
import api from '../../api/axios';
import { useToast } from '../../components/Toast';

export default function ResearchExport() {
  const toast = useToast();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const [from, setFrom] = useState('2026-01-01');
  const [to, setTo] = useState(today);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(null); // null | 'json' | 'csv' | 'excel'

  // Include toggles
  const [incSnapshots, setIncSnapshots] = useState(true);
  const [incAudit, setIncAudit] = useState(true);
  const [incExports, setIncExports] = useState(true);
  const [incSummary, setIncSummary] = useState(true);

  useEffect(() => {
    fetchPreview();
  }, [from, to]);

  async function fetchPreview() {
    setLoading(true);
    try {
      const r = await api.get(`/admin/research-export/preview?from=${from}&to=${to}`);
      setPreview(r.data?.data || null);
    } catch { setPreview(null); }
    finally { setLoading(false); }
  }

  function getInclude() {
    const include = [];
    if (incSnapshots) include.push('snapshots');
    if (incAudit) include.push('audit');
    if (incExports) include.push('exports');
    if (incSummary) include.push('summary');
    return include;
  }

  const EXT_MAP = { json: 'json', csv: 'csv', excel: 'xlsx' };

  async function handleExport(format = 'json') {
    const include = getInclude();
    if (include.length === 0) { toast.error('กรุณาเลือกอย่างน้อย 1 ชุดข้อมูล'); return; }

    setExporting(format);
    try {
      const token = localStorage.getItem('access_token');
      const dateTag = `${from.replace(/-/g, '')}-${to.replace(/-/g, '')}`;
      const url = `/api/admin/research-export?from=${from}&to=${to}&include=${include.join(',')}&download=true&format=${format}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `research-dataset-${dateTag}.${EXT_MAP[format]}`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success('ดาวน์โหลดสำเร็จ');
    } catch {
      toast.error('ดาวน์โหลดไม่สำเร็จ');
    } finally { setExporting(null); }
  }

  return (
    <div className="p-3 sm:p-6 max-w-4xl mx-auto pb-10">
      {/* Header */}
      <div className="bg-blue-800 text-white rounded-xl px-5 py-4 mb-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <p className="text-xs text-blue-200 uppercase tracking-wider">Research Dataset</p>
            <h1 className="text-lg font-semibold">ส่งออกชุดข้อมูลวิจัย</h1>
            <p className="text-sm text-blue-200 mt-0.5">Snapshot • Action Logs • Export Evidence • Summary</p>
          </div>
          <span className="bg-blue-600 text-blue-100 text-xs font-medium px-3 py-1.5 rounded-full shrink-0">Admin only</span>
        </div>
      </div>

      {/* Export form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">ตั้งค่าการส่งออก</h2>

        {/* Date range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">วันที่เริ่มต้น</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">วันที่สิ้นสุด</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base" />
          </div>
        </div>

        {/* Dataset selection */}
        <div>
          <p className="text-xs text-gray-500 mb-2">ชุดข้อมูลที่ต้องการ</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Toggle label="Snapshots" checked={incSnapshots} onChange={setIncSnapshots} desc="daily_snapshots" />
            <Toggle label="Action Logs" checked={incAudit} onChange={setIncAudit} desc="audit_logs" />
            <Toggle label="Export Evidence" checked={incExports} onChange={setIncExports} desc="export events" />
            <Toggle label="Summary" checked={incSummary} onChange={setIncSummary} desc="aggregated" />
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">ตัวอย่างข้อมูลที่จะส่งออก</h2>
        {loading ? (
          <p className="text-gray-400 text-center py-4">กำลังตรวจสอบ…</p>
        ) : preview ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <PreviewCard label="Snapshots" value={preview.snapshots} sub={`${preview.baselines} baseline`} />
            <PreviewCard label="Audit Logs" value={preview.audit_logs} />
            <PreviewCard label="Export Logs" value={preview.export_logs} />
            <PreviewCard label="ช่วงวันที่" value={`${fmtDate(preview.earliest_snapshot)} — ${fmtDate(preview.latest_snapshot)}`} small />
          </div>
        ) : (
          <p className="text-gray-400 text-center py-4">ไม่มีข้อมูลในช่วงที่เลือก</p>
        )}
      </div>

      {/* Export buttons */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">ดาวน์โหลดชุดข้อมูล</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <button onClick={() => handleExport('json')} disabled={exporting !== null}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl transition text-base">
            {exporting === 'json' ? 'กำลังสร้าง…' : '📦 JSON'}
          </button>
          <button onClick={() => handleExport('csv')} disabled={exporting !== null}
            className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl transition text-base">
            {exporting === 'csv' ? 'กำลังสร้าง…' : '📄 CSV'}
          </button>
          <button onClick={() => handleExport('excel')} disabled={exporting !== null}
            className="flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl transition text-base">
            {exporting === 'excel' ? 'กำลังสร้าง…' : '📊 Excel'}
          </button>
        </div>
        <p className="text-xs text-gray-500 text-center">ไฟล์จะถูกบันทึกลงโฟลเดอร์ดาวน์โหลดของเบราว์เซอร์โดยอัตโนมัติ</p>
        <div className="flex flex-wrap justify-center gap-4 mt-2 text-xs text-gray-400">
          <span>JSON — ข้อมูลดิบสำหรับวิเคราะห์</span>
          <span>CSV — เปิดใน Excel/Sheets ได้ทันที</span>
          <span>Excel — หลาย sheet แยกตามชุดข้อมูล</span>
        </div>
      </div>

      {/* Data dictionary */}
      <details className="bg-gray-50 rounded-xl border border-gray-200">
        <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gray-600">📖 คำอธิบายชุดข้อมูล (Data Dictionary)</summary>
        <div className="border-t border-gray-200 px-4 py-3 text-xs text-gray-600 space-y-3">
          <div>
            <p className="font-semibold text-gray-700">snapshots[]</p>
            <p>ข้อมูลสรุปรายวัน: จำนวนนักเรียน, รถ, ประกัน, ผลตรวจ, ความครบถ้วน, completion rate</p>
            <p className="text-gray-400">Fields: snapshot_date, total_students, students_with_vehicle, students_with_parent, total_vehicles, vehicles_with_insurance, vehicles_inspected, vehicles_passed, morning_total/done, evening_total/done, emergency_count, active_users, total_users, is_baseline, baseline_note, run_type</p>
          </div>
          <div>
            <p className="font-semibold text-gray-700">audit_logs[]</p>
            <p>ประวัติ action ทั้งหมด: login, create, update, delete, export, import, approve</p>
            <p className="text-gray-400">Fields: id, user_id, user_role, action, entity_type, entity_id, new_value, created_at</p>
            <p className="text-amber-600">⚠️ ไม่รวม: ip_address, user_agent, old_value (privacy)</p>
          </div>
          <div>
            <p className="font-semibold text-gray-700">export_evidence[]</p>
            <p>เฉพาะ action=EXPORT — หลักฐานการดาวน์โหลดรายงาน</p>
            <p className="text-gray-400">Fields: id, user_id, user_role, entity_type (report_csv/report_excel/report_pdf), entity_id, new_value, created_at</p>
          </div>
          <div>
            <p className="font-semibold text-gray-700">summary{}</p>
            <p>สรุป aggregate: จำนวนรวม, แยกตาม action type, แยกตาม role</p>
          </div>
        </div>
      </details>
    </div>
  );
}

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Toggle({ label, checked, onChange, desc }) {
  return (
    <label className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition ${checked ? 'bg-blue-50 border-blue-300' : 'bg-gray-50 border-gray-200'}`}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded text-blue-600" />
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {desc && <p className="text-xs text-gray-400">{desc}</p>}
      </div>
    </label>
  );
}

function PreviewCard({ label, value, sub, small }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <p className={`font-semibold text-gray-800 ${small ? 'text-sm' : 'text-xl'}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}
