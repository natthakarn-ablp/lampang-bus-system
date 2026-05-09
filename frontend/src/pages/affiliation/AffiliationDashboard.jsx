import { useState, useEffect } from 'react';
import api from '../../api/axios';
import DashboardCard from '../../components/DashboardCard';
import { DonutChart } from '../../components/MiniCharts';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import { SkeletonKpiGrid } from '../../components/Skeleton';
import { IconMap } from '../../components/icons';
import { PAGE_TITLES, CARD_LABELS, CHART_TITLES, STATUS, UI_MESSAGES, MORNING_SEGMENTS, EVENING_SEGMENTS } from '../../constants/uiLabels';

export default function AffiliationDashboard() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notified, setNotified] = useState({});

  useEffect(() => {
    api.get('/affiliation/dashboard')
      .then((res) => setData(res.data.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title={PAGE_TITLES.AFFILIATION_DASHBOARD}
        subtitle={data?.affiliation?.name}
        meta={data?.date
          ? `วันที่ ${new Date(data.date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}`
          : null}
        icon={IconMap}
        iconColor="sky"
      />

      {loading ? (
        <SkeletonKpiGrid count={5} />
      ) : !data ? (
        <p className="text-gray-400 py-10 text-center">{UI_MESSAGES.NO_DATA}</p>
      ) : (
        <>
          {/* ── หมวด 1: สิ่งที่ต้องติดตาม ── */}
          {(() => {
            const schools_pending = data.schools_not_complete?.length ?? 0;
            const issues = [];
            if (schools_pending > 0) issues.push(`🏫 ${schools_pending} โรงเรียนยังมีรายการค้าง`);
            if ((data.morning_pending ?? 0) > 0) issues.push(`🌅 รอส่งเช้า ${data.morning_pending} คน`);
            if ((data.evening_pending ?? 0) > 0) issues.push(`🌆 รอรับเย็น ${data.evening_pending} คน`);
            if ((data.recent_emergencies ?? 0) > 0) issues.push(`🚨 เหตุฉุกเฉิน ${data.recent_emergencies} ครั้ง`);
            return issues.length > 0 ? (
              <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-3 mb-4">
                <p className="text-sm font-bold text-amber-800 mb-1">สิ่งที่ต้องติดตามวันนี้</p>
                {issues.map((msg, i) => <p key={i} className="text-sm text-amber-700">{msg}</p>)}
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 mb-4 text-center">
                <p className="text-sm font-bold text-green-700">✅ ทุกโรงเรียนในสังกัดดำเนินการครบ</p>
              </div>
            );
          })()}

          {/* ── หมวด 2: ภาพรวม ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            <DashboardCard label={CARD_LABELS.SCHOOLS} value={data.total_schools} color="blue" />
            <DashboardCard label={CARD_LABELS.TOTAL_STUDENTS} value={data.total_students} color="blue" />
            <DashboardCard label={CARD_LABELS.VEHICLES} value={data.total_vehicles} color="blue" />
            <DashboardCard label={CARD_LABELS.STUDENT_LEAVE} value={data.leave_count ?? 0}
              color={(data.leave_count ?? 0) > 0 ? 'yellow' : 'gray'} />
            <DashboardCard label={CARD_LABELS.EMERGENCY_7D} value={data.recent_emergencies}
              color={data.recent_emergencies > 0 ? 'red' : 'gray'} />
          </div>

          {/* ── หมวด 3: สถานะรับ-ส่ง ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <p className="text-sm font-semibold text-gray-600 mb-4 text-center">{CHART_TITLES.MORNING_STATUS}</p>
              <DonutChart size={160} thickness={22}
                label={data.morning_total > 0 ? `${Math.round((data.morning_done / data.morning_total) * 100)}%` : '0%'}
                sublabel={`ส่งแล้ว ${data.morning_done}/${data.morning_total} คน`}
                segments={MORNING_SEGMENTS(data.morning_done ?? 0, data.morning_leave ?? 0, data.morning_pending ?? 0)}
              />
              <div className="flex justify-center gap-6 mt-3 text-sm">
                <span className="text-green-600 font-medium">✅ ส่งแล้ว {data.morning_done}</span>
                <span className="text-amber-600">ลา {data.morning_leave ?? 0}</span>
                <span className="text-red-500 font-medium">รอ {data.morning_pending}</span>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <p className="text-sm font-semibold text-gray-600 mb-4 text-center">{CHART_TITLES.EVENING_STATUS}</p>
              <DonutChart size={160} thickness={22}
                label={data.evening_total > 0 ? `${Math.round((data.evening_done / data.evening_total) * 100)}%` : '0%'}
                sublabel={`รับแล้ว ${data.evening_done}/${data.evening_total} คน`}
                segments={EVENING_SEGMENTS(data.evening_done ?? 0, data.evening_leave ?? 0, data.evening_pending ?? 0)}
              />
              <div className="flex justify-center gap-6 mt-3 text-sm">
                <span className="text-green-600 font-medium">✅ รับแล้ว {data.evening_done}</span>
                <span className="text-amber-600">ลา {data.evening_leave ?? 0}</span>
                <span className="text-red-500 font-medium">รอ {data.evening_pending}</span>
              </div>
            </div>
          </div>

          {/* ── Schools status with bar chart per school ── */}
          <section className="mb-6">
            <h2 className="text-base font-bold text-gray-700 mb-3">
              โรงเรียนที่ยังมีรายการค้าง
              {data.schools_not_complete?.length > 0 && ` (${data.schools_not_complete.length} แห่ง)`}
            </h2>

            {(!data.schools_not_complete || data.schools_not_complete.length === 0) ? (
              <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-4 text-base font-medium text-center">
                ✅ {UI_MESSAGES.ALL_SCHOOLS_DONE}
              </div>
            ) : (
              <div className="space-y-3">
                {data.schools_not_complete.map((s) => {
                  const mTotal = s.morning_expected || 0;
                  const mDone = s.morning_done || 0;
                  const mPend = s.morning_pending || 0;
                  const mDonePct = mTotal > 0 ? Math.round((mDone / mTotal) * 100) : 0;
                  const eTotal = s.evening_expected || 0;
                  const eDone = s.evening_done || 0;
                  const ePend = s.evening_pending || 0;
                  const eDonePct = eTotal > 0 ? Math.round((eDone / eTotal) * 100) : 0;

                  return (
                    <div key={s.school_id} className="bg-white rounded-xl border border-gray-200 p-4">
                      <p className="text-base font-bold text-gray-800 mb-1">{s.school_name}</p>

                      {/* Info badges + Notify */}
                      <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600 mb-3">
                        <span>👨‍🎓 นักเรียน <strong>{s.student_count ?? '-'}</strong></span>
                        <span>🚌 รถรับส่ง <strong>{s.vehicle_count ?? '-'}</strong></span>
                        <button
                          onClick={async () => {
                            const msg = `แจ้งเตือนจากสังกัด: โรงเรียน${s.school_name} ยังมีข้อมูลนักเรียนค้าง (เช้า ${s.morning_pending || 0} คน, เย็น ${s.evening_pending || 0} คน) กรุณาตรวจสอบและดำเนินการในระบบ`;
                            try {
                              await navigator.clipboard.writeText(msg);
                              await api.post('/affiliation/notify-school', {
                                school_id: s.school_id, school_name: s.school_name, message: msg, method: 'copy',
                              });
                              setNotified(prev => ({ ...prev, [s.school_id]: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) }));
                              toast.success('คัดลอกข้อความแล้ว — ส่งผ่าน LINE/โทรศัพท์ได้เลย');
                            } catch { toast.error('ไม่สำเร็จ'); }
                          }}
                          className={`ml-auto text-xs font-medium px-3 py-1.5 rounded-lg transition border ${
                            notified[s.school_id]
                              ? 'bg-green-50 text-green-600 border-green-200'
                              : 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'
                          }`}
                        >
                          {notified[s.school_id] ? `แจ้งแล้ว ${notified[s.school_id]}` : '📋 แจ้งเตือน'}
                        </button>
                      </div>

                      {/* Morning stacked bar */}
                      <div className="mb-3">
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium text-gray-700">🌅 ส่งเช้า</span>
                          <span className="text-gray-500">{mDone}/{mTotal} ({mDonePct}%)</span>
                        </div>
                        <div className="flex w-full h-5 rounded-full overflow-hidden bg-gray-100">
                          {mDone > 0 && (
                            <div className="bg-green-500 h-full" style={{ width: `${mDonePct}%` }} />
                          )}
                          {mPend > 0 && (
                            <div className="bg-red-400 h-full" style={{ width: `${100 - mDonePct}%` }} />
                          )}
                        </div>
                        <div className="flex justify-between text-xs mt-0.5">
                          <span className="text-green-600 font-medium">ส่งแล้ว {mDone}</span>
                          <span className="text-red-500 font-medium">รอ {mPend}</span>
                        </div>
                      </div>

                      {/* Evening stacked bar */}
                      <div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="font-medium text-gray-700">🌆 รับเย็น</span>
                          <span className="text-gray-500">{eDone}/{eTotal} ({eDonePct}%)</span>
                        </div>
                        <div className="flex w-full h-5 rounded-full overflow-hidden bg-gray-100">
                          {eDone > 0 && (
                            <div className="bg-green-500 h-full" style={{ width: `${eDonePct}%` }} />
                          )}
                          {ePend > 0 && (
                            <div className="bg-red-400 h-full" style={{ width: `${100 - eDonePct}%` }} />
                          )}
                        </div>
                        <div className="flex justify-between text-xs mt-0.5">
                          <span className="text-green-600 font-medium">รับแล้ว {eDone}</span>
                          <span className="text-red-500 font-medium">รอ {ePend}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
