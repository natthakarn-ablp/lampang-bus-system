import { Building2, Bus, ChevronDown, RefreshCw } from 'lucide-react';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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

      {loading ? (
        <LoadingState />
      ) : !data?.schools?.length ? (
        <EmptyState title="ยังไม่มีข้อมูล" description="ยังไม่มีโรงเรียนที่ส่งข้อมูลสถานะวันนี้" />
      ) : (
        <div className="space-y-3">
          {data.schools.map((school) => {
            const allStudents = school.vehicles.flatMap((v) => v.students);
            const morningDone = allStudents.filter((s) => s.morning_enabled && s.morning_done).length;
            const morningTotal = allStudents.filter((s) => s.morning_enabled).length;
            const eveningDone = allStudents.filter((s) => s.evening_enabled && s.evening_done).length;
            const eveningTotal = allStudents.filter((s) => s.evening_enabled).length;
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
                  <div className="flex items-center gap-4 text-sm">
                    <span className={morningDone === morningTotal && morningTotal > 0 ? 'text-success-ink' : 'text-orange-600'}>
                      เช้า {morningDone}/{morningTotal}
                    </span>
                    <span className={eveningDone === eveningTotal && eveningTotal > 0 ? 'text-success-ink' : 'text-indigo-600'}>
                      เย็น {eveningDone}/{eveningTotal}
                    </span>
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
                      const vMorningDone = vehicle.students.filter((s) => s.morning_enabled && s.morning_done).length;
                      const vMorningTotal = vehicle.students.filter((s) => s.morning_enabled).length;
                      const vEveningDone = vehicle.students.filter((s) => s.evening_enabled && s.evening_done).length;
                      const vEveningTotal = vehicle.students.filter((s) => s.evening_enabled).length;
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
