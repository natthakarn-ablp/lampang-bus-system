import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import './SchoolReportDialog.css';

const number = new Intl.NumberFormat('th-TH');

export default function SchoolReportDialog({ report, onClose }) {
  const dialogRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  return createPortal(
    <>
    <dialog ref={dialogRef} aria-labelledby={titleId} onClose={onClose}
      className="affiliation-school-report-dialog w-[calc(100%-2rem)] max-w-4xl max-h-[90dvh] rounded-xl border border-surface-border bg-white p-0 text-ink shadow-xl backdrop:bg-black/40">
      <div className="school-report-actions flex flex-wrap justify-end gap-2 border-b border-surface-border p-4">
        <button type="button" onClick={() => window.print()}
          className="focus-ring min-h-11 rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">
          พิมพ์ / บันทึก PDF
        </button>
        <button type="button" autoFocus onClick={() => dialogRef.current.close()}
          className="focus-ring min-h-11 rounded-lg border border-surface-border px-4 py-2 text-sm font-medium hover:bg-surface">
          ปิดรายงาน
        </button>
      </div>
      <ReportContents report={report} titleId={titleId} />
    </dialog>
    <div className="affiliation-school-report-print" aria-hidden="true">
      <ReportContents report={report} />
    </div>
    </>, document.body,
  );
}

function ReportContents({ report, titleId }) {
  const generatedAt = new Date(report.generated_at).toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok', dateStyle: 'long', timeStyle: 'short',
  });
  return (
      <article className="p-4 sm:p-6">
        <h2 id={titleId} className="text-xl font-semibold text-brand-800">รายงานสรุปโรงเรียนในสังกัด</h2>
        <p className="mt-1 font-medium break-words">{report.affiliation.name}</p>
        <p className="mt-1 text-sm text-ink-muted">ข้อมูล ณ {generatedAt} (เวลาประเทศไทย)</p>
        <dl className="my-5 grid grid-cols-3 gap-3 text-sm">
          <div><dt className="text-ink-muted">โรงเรียน</dt><dd className="mt-1 text-lg font-bold">{number.format(report.summary.total_schools)} แห่ง</dd></div>
          <div><dt className="text-ink-muted">นักเรียน</dt><dd className="mt-1 text-lg font-bold">{number.format(report.summary.total_students)} คน</dd></div>
          <div><dt className="text-ink-muted">รถรับส่ง (ไม่ซ้ำ)</dt><dd className="mt-1 text-lg font-bold">{number.format(report.summary.total_vehicles)} คัน</dd></div>
        </dl>
        <table className="school-report-table w-full border-collapse text-sm">
          <caption className="mb-2 text-left font-medium">ข้อมูลแยกรายโรงเรียน</caption>
          <thead><tr className="bg-brand-50 text-brand-800">
            <th scope="col" className="border border-surface-border px-3 py-3 text-left">โรงเรียน</th>
            <th scope="col" className="border border-surface-border px-3 py-3 text-right">นักเรียน (คน)</th>
            <th scope="col" className="border border-surface-border px-3 py-3 text-right">รถรับส่ง (คัน)</th>
          </tr></thead>
          <tbody>
            {report.schools.length === 0 ? (
              <tr><td colSpan={3} className="border border-surface-border p-4 text-center text-ink-muted">ยังไม่มีโรงเรียนในสังกัด</td></tr>
            ) : report.schools.map((school) => (
              <tr key={school.id}>
                <td className="border border-surface-border px-3 py-3 break-words">{school.name}</td>
                <td className="border border-surface-border px-3 py-3 text-right tabular-nums">{number.format(school.student_count)}</td>
                <td className="border border-surface-border px-3 py-3 text-right tabular-nums">{number.format(school.vehicle_count)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="bg-brand-50 font-bold">
            <td className="border border-surface-border px-3 py-3">รวมทั้งสังกัด (รถไม่นับซ้ำ)</td>
            <td className="border border-surface-border px-3 py-3 text-right tabular-nums">{number.format(report.summary.total_students)}</td>
            <td className="border border-surface-border px-3 py-3 text-right tabular-nums">{number.format(report.summary.total_vehicles)}</td>
          </tr></tfoot>
        </table>
        <p className="mt-3 text-xs text-ink-muted">หมายเหตุ: รถคันเดียวอาจรับส่งหลายโรงเรียน ยอดรถรวมทั้งสังกัดจึงนับแต่ละคันเพียงครั้งเดียว และอาจน้อยกว่าผลรวมรายโรงเรียน</p>
        <p className="mt-2 text-xs text-ink-muted">รายงานนี้สรุปข้อมูลปัจจุบันในระบบ ไม่ใช่สถานะยืนยันการส่งข้อมูลรายภาคเรียน</p>
      </article>
  );
}
