import { useEffect, useState } from 'react';
import api from '../../api/axios';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { AlertBanner, Modal } from '../../components/ui';

const SECONDARY = 'focus-ring min-h-[44px] px-4 rounded-lg border border-surface-border text-ink hover:bg-surface disabled:opacity-50';
const PRIMARY = 'focus-ring min-h-[44px] px-4 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50';

const fullName = s => `${s.prefix || ''}${s.first_name || ''} ${s.last_name || ''}`.trim();

// นักเรียนผูกรถแล้ว / ยังไม่ผูกรถ แยกตามสายชั้น.
// บัญชีโรงเรียนเห็นทุกสายชั้น; ครูประจำสายชั้นเห็นเฉพาะสายชั้นตน (backend บังคับ).
export default function GradeVehicleSummaryModal({ onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(null); // `${grade}|with` | `${grade}|without`
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    let alive = true;
    setError(''); setData(null);
    api.get('/school/grade-vehicle-summary')
      .then(r => { if (alive) setData(r.data?.data || null); })
      .catch(err => { if (alive) setError(err?.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'); });
    return () => { alive = false; };
  }, [attempt]);

  async function downloadExcel() {
    if (downloading) return;
    setDownloading(true); setDownloadError('');
    try {
      const res = await api.get('/school/grade-vehicle-summary?format=xlsx', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
      link.href = url;
      link.download = `นักเรียนผูกรถตามสายชั้น-${date}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setDownloadError('ดาวน์โหลด Excel ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setDownloading(false);
    }
  }

  const toggle = key => setOpen(o => (o === key ? null : key));

  return (
    <Modal title="สรุปนักเรียนผูกรถ แยกตามสายชั้น" size="lg" onClose={onClose}
      footer={(
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={SECONDARY} onClick={onClose}>ปิด</button>
          <button type="button" className={PRIMARY} onClick={downloadExcel} disabled={!data || downloading}>
            {downloading ? 'กำลังดาวน์โหลด…' : 'ดาวน์โหลด Excel'}
          </button>
        </div>
      )}>
      {error ? <ErrorState message={error} onRetry={() => setAttempt(n => n + 1)} />
        : !data ? <LoadingState message="กำลังดึงรายชื่อนักเรียน…" />
        : (
          <div className="space-y-4">
            {downloadError && <AlertBanner variant="danger">{downloadError}</AlertBanner>}
            {data.grade_scope && (
              <p className="text-sm text-ink-muted">แสดงเฉพาะสายชั้น {data.grade_scope} ตามสิทธิ์บัญชีครูประจำสายชั้น</p>
            )}
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="นักเรียนทั้งหมด" value={data.totals.total} />
              <Stat label="ผูกรถแล้ว" value={data.totals.with_vehicle} tone="text-success-ink" />
              <Stat label="ยังไม่ผูกรถ" value={data.totals.without_vehicle} tone="text-warn-ink" />
            </div>

            {data.grades.length === 0 ? (
              <AlertBanner variant="info">ยังไม่มีรายชื่อนักเรียน</AlertBanner>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-surface-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-ink-muted">
                    <tr>
                      <th scope="col" className="text-left px-3 py-2">สายชั้น</th>
                      <th scope="col" className="text-right px-3 py-2">ทั้งหมด</th>
                      <th scope="col" className="text-right px-3 py-2">ผูกรถแล้ว</th>
                      <th scope="col" className="text-right px-3 py-2">ยังไม่ผูกรถ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.grades.map(g => (
                      <GradeRows key={g.grade} g={g} open={open} toggle={toggle} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-ink-muted">กดตัวเลขเพื่อดูรายชื่อ · ไฟล์ Excel มี 3 แผ่นงาน: สรุปตามสายชั้น, ผูกรถแล้ว, ยังไม่ผูกรถ</p>
          </div>
        )}
    </Modal>
  );
}

function Stat({ label, value, tone = 'text-ink' }) {
  return (
    <div className="rounded-lg border border-surface-border p-2">
      <div className={`text-xl font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-xs text-ink-muted">{label}</div>
    </div>
  );
}

function CountButton({ count, active, onClick, tone }) {
  if (!count) return <span className="tabular-nums text-ink-muted">0</span>;
  return (
    <button type="button" onClick={onClick} aria-expanded={active}
      className={`focus-ring min-h-[36px] px-2 rounded underline-offset-2 hover:underline tabular-nums font-medium ${tone}`}>
      {count}
    </button>
  );
}

function GradeRows({ g, open, toggle }) {
  const withKey = `${g.grade}|with`;
  const withoutKey = `${g.grade}|without`;
  const list = open === withKey ? g.students_with_vehicle : open === withoutKey ? g.students_without_vehicle : null;
  return (
    <>
      <tr className="border-t border-surface-border">
        <th scope="row" className="text-left px-3 py-2 font-medium">{g.grade}</th>
        <td className="text-right px-3 py-2 tabular-nums">{g.total}</td>
        <td className="text-right px-3 py-1">
          <CountButton count={g.with_vehicle} active={open === withKey} onClick={() => toggle(withKey)} tone="text-success-ink" />
        </td>
        <td className="text-right px-3 py-1">
          <CountButton count={g.without_vehicle} active={open === withoutKey} onClick={() => toggle(withoutKey)} tone="text-warn-ink" />
        </td>
      </tr>
      {list && (
        <tr className="bg-surface/50">
          <td colSpan={4} className="px-3 py-2">
            <p className="text-xs text-ink-muted mb-1">
              {g.grade} · {open === withKey ? 'ผูกรถแล้ว' : 'ยังไม่ผูกรถ'} {list.length} คน
            </p>
            <ul className="divide-y divide-surface-border">
              {list.map(s => (
                <li key={s.id} className="py-1.5 flex flex-wrap justify-between gap-x-3">
                  <span>{fullName(s)} <span className="text-ink-muted">· ห้อง {s.classroom || '-'} · รหัส {s.id}</span></span>
                  {s.plate_no && <span className="text-ink-muted">รถ {s.plate_no}</span>}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
