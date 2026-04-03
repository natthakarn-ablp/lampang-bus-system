import { forwardRef } from 'react';
import { safePct, levelBadge, sortByKpi } from '../utils/kpi';

const SummaryPrintView = forwardRef(function SummaryPrintView({ data, user }, ref) {
  if (!data) return null;

  const schools100 = data.schools?.filter(s => (s.morning_kpi ?? 0) >= 100 && (s.evening_kpi ?? 0) >= 100).length ?? 0;
  const now = new Date().toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' });
  const reportDate = data.date
    ? new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
    : now;

  const roleLabel = {
    driver: 'คนขับรถ', school: 'โรงเรียน', affiliation: 'สังกัด', province: 'จังหวัด', admin: 'ผู้ดูแลระบบ',
  }[user?.role] || user?.role;

  return (
    <div ref={ref}>
      {/* Header */}
      <div className="header">
        <h1>ระบบรถรับส่งนักเรียนจังหวัดลำปาง</h1>
        <h2>รายงานสรุปภาพรวมการรับ-ส่งนักเรียน</h2>
        <div className="meta">
          <span>วันที่ข้อมูล: {reportDate}</span>
          <span>สิทธิ์: {roleLabel} — {user?.display_name || user?.username}</span>
          <span>ออกรายงาน: {now}</span>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="mb-4">
        <div className="section-title">สรุปผลการดำเนินงาน</div>
        <table className="kpi-table">
          <tbody>
            <tr>
              <td className="label">นักเรียนทั้งหมด</td>
              <td className="value">{data.total_students ?? '-'}</td>
              <td className="label">รถรับส่ง</td>
              <td className="value">{data.total_vehicles ?? '-'}</td>
              <td className="label">เหตุฉุกเฉิน</td>
              <td className="value">{data.emergency_count ?? 0}</td>
            </tr>
            <tr>
              <td className="label">KPI ส่งเช้า</td>
              <td className="value">{safePct(data.morning_kpi)} ({data.morning_done}/{data.morning_total})</td>
              <td className="label">KPI รับเย็น</td>
              <td className="value">{safePct(data.evening_kpi)} ({data.evening_done}/{data.evening_total})</td>
              <td className="label">โรงเรียนครบ 100%</td>
              <td className="value">{schools100} / {data.schools?.length ?? 0}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Affiliation Table */}
      {data.affiliations?.length > 0 && (
        <div className="mb-4">
          <div className="section-title">สรุปตามสังกัด</div>
          <table>
            <thead>
              <tr>
                <th className="text-left">สังกัด</th>
                <th className="text-center">นักเรียน</th>
                <th className="text-center">KPI เช้า</th>
                <th className="text-center">KPI เย็น</th>
                <th className="text-center">ระดับ</th>
              </tr>
            </thead>
            <tbody>
              {sortByKpi(data.affiliations).map(a => (
                <tr key={a.affiliation_id}>
                  <td>{a.affiliation_name}</td>
                  <td className="text-center">{a.student_count}</td>
                  <td className="text-center">{safePct(a.morning_kpi)}</td>
                  <td className="text-center">{safePct(a.evening_kpi)}</td>
                  <td className="text-center">{levelBadge(a.morning_kpi, a.evening_kpi).label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* School Table */}
      {data.schools?.length > 0 && (
        <div className={data.affiliations?.length > 3 ? 'page-break mb-4' : 'mb-4'}>
          <div className="section-title">สรุปตามโรงเรียน</div>
          <table>
            <thead>
              <tr>
                <th className="text-left">โรงเรียน</th>
                <th className="text-center">นักเรียน</th>
                <th className="text-center">KPI เช้า</th>
                <th className="text-center">KPI เย็น</th>
                <th className="text-center">ระดับ</th>
              </tr>
            </thead>
            <tbody>
              {sortByKpi(data.schools).map(s => (
                <tr key={s.school_id}>
                  <td>{s.school_name}</td>
                  <td className="text-center">{s.student_count}</td>
                  <td className="text-center">{safePct(s.morning_kpi)}</td>
                  <td className="text-center">{safePct(s.evening_kpi)}</td>
                  <td className="text-center">{levelBadge(s.morning_kpi, s.evening_kpi).label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Vehicle Table */}
      {data.vehicles?.length > 0 && (
        <div className={data.schools?.length > 5 ? 'page-break mb-4' : 'mb-4'}>
          <div className="section-title">สรุปตามรถ</div>
          <table>
            <thead>
              <tr>
                <th className="text-left">ทะเบียนรถ</th>
                <th className="text-center">นักเรียน</th>
                <th className="text-center">KPI เช้า</th>
                <th className="text-center">KPI เย็น</th>
                <th className="text-center">ระดับ</th>
              </tr>
            </thead>
            <tbody>
              {sortByKpi(data.vehicles).map(v => (
                <tr key={v.vehicle_id}>
                  <td>{v.plate_no}</td>
                  <td className="text-center">{v.student_count}</td>
                  <td className="text-center">{safePct(v.morning_kpi)}</td>
                  <td className="text-center">{safePct(v.evening_kpi)}</td>
                  <td className="text-center">{levelBadge(v.morning_kpi, v.evening_kpi).label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <div className="footer">
        <span>ออกรายงาน: {now} โดย {user?.display_name || user?.username} ({roleLabel})</span>
        <span>หมายเหตุ: รายงานนี้แสดงข้อมูลตามสิทธิ์ของผู้ใช้งาน</span>
      </div>
    </div>
  );
});

export default SummaryPrintView;
