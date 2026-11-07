import { StatusHero, TravelLeaveSummary, roundStatus } from '../../components/dashboard';
import { isBusRider, visibleAttendance } from '../../utils/attendance';
import { Building2, Bus, ChevronDown, RefreshCw } from 'lucide-react';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { tone } from '../../components/ui/tone';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import StudentStatusTable from '../../components/StudentStatusTable';
import PlateSearchInput from '../../components/PlateSearchInput';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';

const REFRESH_INTERVAL_MS = 30_000;

export default function AffDailyStatus() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedSchool, setExpandedSchool] = useState(null);
  const [expandedVehicle, setExpandedVehicle] = useState(null);
  const [plateSearch, setPlateSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const requestInFlight = useRef(false);

  const refreshStatus = useCallback(async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setRefreshing(true);
    try {
      const res = await api.get('/affiliation/status-today');
      setData(res.data.data);
      setError('');
      setLastUpdatedAt(new Date());
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      requestInFlight.current = false;
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshStatus();
    };
    const timer = setInterval(refreshWhenVisible, REFRESH_INTERVAL_MS);
    const onVisibilityChange = () => {
      refreshWhenVisible();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshStatus]);

  function toggleSchool(schoolId) {
    setExpandedSchool((prev) => (prev === schoolId ? null : schoolId));
    setExpandedVehicle(null);
  }

  function toggleVehicle(key) {
    setExpandedVehicle((prev) => (prev === key ? null : key));
  }

  // Phase 9.11 — flatten the school→vehicles tree for plate autocomplete.
  // Each suggestion carries plate_no (primary) + school_name (secondary)
  // so PlateSearchInput's existing metaText() picks the right label.
  const vehicleSuggestions = useMemo(() => {
    if (!data?.schools) return [];
    return data.schools.flatMap(s =>
      (s.vehicles || []).map(v => ({
        plate_no: v.plate_no,
        school_name: s.school_name,
      }))
    );
  }, [data]);

  // Per-school numbers once, so the hero, the ordering and the rows agree.
  const schoolRows = useMemo(() => (data?.schools || []).map((school) => {
    const students = school.vehicles.flatMap((v) => v.students);
    const count = (session) => {
      const riders = students.filter((s) => isBusRider(s, session));
      return { done: riders.filter((s) => s[`${session}_done`]).length, expected: riders.length };
    };
    return { school, students, morning: count('morning'), evening: count('evening') };
  }), [data]);

  const when = { date: data?.date, isSchoolDay: data?.is_school_day };
  const sumRound = (session) => schoolRows.reduce(
    (acc, r) => ({ done: acc.done + r[session].done, expected: acc.expected + r[session].expected }),
    { done: 0, expected: 0 },
  );
  const morningStatus = roundStatus({ session: 'morning', ...sumRound('morning'), ...when });
  const eveningStatus = roundStatus({ session: 'evening', ...sumRound('evening'), ...when });
  // Schools that still need a call come first; the rest keep the API order.
  const needsFollowUp = (r) => ['morning', 'evening'].some((session) => {
    const st = roundStatus({ session, ...r[session], ...when });
    return st.tone === 'warn' || st.tone === 'danger';
  });
  const orderedRows = [...schoolRows].sort((a, b) => Number(needsFollowUp(b)) - Number(needsFollowUp(a)));
  const followCount = schoolRows.filter(needsFollowUp).length;

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        title="สถานะวันนี้"
        subtitle="ความคืบหน้าการรับ-ส่งนักเรียนรายคันในสังกัด"
        meta={[
          data?.date
            ? `ข้อมูล ณ ${new Date(data.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}`
            : null,
          lastUpdatedAt
            ? `อัปเดตล่าสุด ${lastUpdatedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
            : null,
        ].filter(Boolean).join(' · ') || undefined}
        actions={(
          <>
            <PlateSearchInput value={plateSearch} onChange={setPlateSearch} suggestions={vehicleSuggestions} />
            <button
              type="button"
              onClick={refreshStatus}
              disabled={refreshing}
              aria-label="รีเฟรชข้อมูลสถานะ"
              title="รีเฟรชข้อมูลสถานะ"
              className="focus-ring inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-surface-border bg-surface-raised text-ink-muted transition hover:bg-surface hover:text-ink disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={2} aria-hidden="true" />
            </button>
          </>
        )}
      />

      {error && <ErrorState message={error} className="mb-4" />}

      {data && !loading && !error && data.schools?.length > 0 && (
        <StatusHero
          className="mb-4"
          eyebrow={`ทุกโรงเรียนในสังกัด · ${data.schools.length} โรงเรียน`}
          rounds={[
            { status: morningStatus, title: 'รอบเช้า · ส่งถึงโรงเรียน' },
            { status: eveningStatus, title: 'รอบเย็น · ส่งถึงบ้าน' },
          ]}
        >
          {followCount > 0 && (
            <p className="mt-4 text-sm text-ink">
              <b className="tabular-nums">{followCount.toLocaleString('th-TH')}</b> โรงเรียนต้องติดตาม — แสดงไว้บนสุดของรายการด้านล่าง
            </p>
          )}
        </StatusHero>
      )}

      {data && !loading && !error && <TravelLeaveSummary data={visibleAttendance(data)} className="mb-4" />}

      {loading ? (
        <LoadingState />
      ) : !data?.schools?.length ? (
        <EmptyState title="ยังไม่มีข้อมูล" description="ยังไม่มีโรงเรียนที่ส่งข้อมูลสถานะวันนี้" />
      ) : (
        <div className="space-y-3">
          {orderedRows.map(({ school, students: allStudents, morning, evening }) => {
            const mSt = roundStatus({ session: 'morning', ...morning, ...when });
            const eSt = roundStatus({ session: 'evening', ...evening, ...when });
            const isSchoolExpanded = expandedSchool === school.school_id;

            return (
              <div key={school.school_id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* School header */}
                <button
                  onClick={() => toggleSchool(school.school_id)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition"
                >
                  <div>
                    <h3 className="font-semibold text-gray-800">{school.school_name}</h3>
                    <p className="text-xs text-ink-muted mt-0.5">
                      {allStudents.length} คน · {school.vehicles.length} คัน
                    </p>
                  </div>
                  <div className="flex items-center gap-2 sm:gap-3 text-sm shrink-0">
                    <RoundPill label="เช้า" st={mSt} />
                    <RoundPill label="เย็น" st={eSt} />
                    <ChevronDown
                      className={`w-4 h-4 text-ink-muted shrink-0 transition-transform ${isSchoolExpanded ? 'rotate-180' : ''}`}
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  </div>
                </button>

                {/* Expanded vehicles */}
                {isSchoolExpanded && (
                  <div className="border-t border-gray-100">
                    {school.vehicles.filter(v => !plateSearch || v.plate_no.toLowerCase().includes(plateSearch.toLowerCase())).map((vehicle) => {
                      const vMorningDone = vehicle.students.filter((s) => isBusRider(s, 'morning') && s.morning_done).length;
                      const vMorningTotal = vehicle.students.filter((s) => isBusRider(s, 'morning')).length;
                      const vEveningDone = vehicle.students.filter((s) => isBusRider(s, 'evening') && s.evening_done).length;
                      const vEveningTotal = vehicle.students.filter((s) => isBusRider(s, 'evening')).length;
                      const vKey = `${school.school_id}-${vehicle.vehicle_id}`;
                      const isVehicleExpanded = expandedVehicle === vKey;

                      return (
                        <div key={vKey} className="border-t border-gray-50">
                          <button
                            onClick={() => toggleVehicle(vKey)}
                            className="w-full flex items-center justify-between px-7 py-3 text-left hover:bg-gray-50 transition"
                          >
                            <div className="flex items-center gap-2">
                              <Bus className="w-4 h-4 text-ink-muted shrink-0" strokeWidth={2} aria-hidden="true" />
                              <span className="text-sm font-medium text-gray-700">{vehicle.plate_no}</span>
                              <span className="text-xs text-ink-muted">({vehicle.students.length} คน)</span>
                            </div>
                            <div className="flex items-center gap-3 text-xs">
                              <span className={vMorningDone === vMorningTotal && vMorningTotal > 0 ? 'text-success-ink' : 'text-orange-500'}>
                                เช้า {vMorningDone}/{vMorningTotal}
                              </span>
                              <span className={vEveningDone === vEveningTotal && vEveningTotal > 0 ? 'text-success-ink' : 'text-indigo-500'}>
                                เย็น {vEveningDone}/{vEveningTotal}
                              </span>
                              <ChevronDown
                        className={`w-4 h-4 text-ink-muted shrink-0 transition-transform ${isVehicleExpanded ? 'rotate-180' : ''}`}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                            </div>
                          </button>

                          {isVehicleExpanded && (
                          <div className="px-4 pb-3">
                            <StudentStatusTable
                              students={vehicle.students}
                              caption={`สถานะนักเรียนในรถ ${vehicle.plate_no || ''}`}
                            />
                          </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// done/expected plus the time-aware word, so a pill is never red before the round.
function RoundPill({ label, st }) {
  return (
    <span className={`inline-flex flex-col items-center rounded-lg px-2 py-1 leading-tight ${tone(st.tone).soft} ${tone(st.tone).ink}`}>
      <span className="text-xs">{label}</span>
      <span className="font-semibold tabular-nums">{st.done}/{st.expected}</span>
    </span>
  );
}
