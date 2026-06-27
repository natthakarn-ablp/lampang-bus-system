import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Check, X, ClipboardCheck, Search, FileText, Eye } from 'lucide-react';
import api from '../../api/axios';
import LoadingState from '../../components/LoadingState';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { isGradeTeacher } from '../../utils/authScope';

const APPROVAL = {
  PENDING_SCHOOL_REVIEW: { label: 'รอตรวจสอบ', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  APPROVED:              { label: 'อนุมัติแล้ว', cls: 'bg-green-50 text-green-700 border-green-200' },
  NEEDS_REVISION:        { label: 'ส่งกลับแก้ไข', cls: 'bg-red-50 text-red-700 border-red-200' },
  REJECTED:              { label: 'ปฏิเสธ', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};
const PICKUP_LABEL = { MORNING: 'เช้า', EVENING: 'เย็น', BOTH: 'ทั้งวัน' };

function Pill({ status }) {
  const a = APPROVAL[status] || APPROVAL.PENDING_SCHOOL_REVIEW;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${a.cls}`}>{a.label}</span>;
}

export default function SchoolRegistrationReview() {
  const toast = useToast();
  const { user } = useAuth();
  const isTeacher = isGradeTeacher(user);

  const [filter, setFilter] = useState('PENDING_SCHOOL_REVIEW');
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // application_id when viewing detail

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/school/registrations?status=${filter}`);
      setList(Array.isArray(res?.data?.data) ? res.data.data : []);
    } catch {} finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { if (!selected) fetchList(); }, [fetchList, selected]);

  if (selected) {
    return <RegistrationDetail applicationId={selected} isTeacher={isTeacher}
      onBack={() => setSelected(null)} />;
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-1">ตรวจสอบคำขอขึ้นทะเบียนรถ</h1>
      <p className="text-xs text-gray-400 mb-4">คนขับส่งรายชื่อเด็กของโรงเรียน — ตรวจสอบและจับคู่กับฐานข้อมูล แล้วอนุมัติ</p>

      <div className="flex gap-2 mb-4">
        {[['PENDING_SCHOOL_REVIEW', 'รอตรวจสอบ'], ['APPROVED', 'อนุมัติแล้ว'], ['NEEDS_REVISION', 'ส่งกลับ']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`flex-1 sm:flex-none px-4 py-2.5 text-sm font-medium rounded-lg transition ${filter === val ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingState />
      ) : list.length === 0 ? (
        <p className="text-gray-400 py-10 text-center">ไม่พบคำขอตามเงื่อนไขที่เลือก</p>
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <div key={r.application_id} className="bg-white rounded-xl border border-gray-200 px-4 sm:px-5 py-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">รถ {r.plate_no || '-'}</p>
                <p className="text-xs text-gray-500">
                  {r.roster_count} คน · เช้า {r.morning_rider_count} · เย็น {r.evening_rider_count}
                  {Number(r.unmatched_count) > 0 && <span className="text-amber-600"> · ยังไม่ตรวจ {r.unmatched_count}</span>}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Pill status={r.approval_status} />
                <button onClick={() => setSelected(r.application_id)}
                  className="text-sm font-medium text-blue-600 hover:text-blue-800">ตรวจสอบ →</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RegistrationDetail({ applicationId, isTeacher, onBack }) {
  const toast = useToast();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [approving, setApproving] = useState(false);
  // Manual student search (for roster rows with no auto-match)
  const [searchFor, setSearchFor] = useState(null); // rosterId currently searching
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/school/registrations/${applicationId}`);
      setDetail(res?.data?.data || null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'โหลดไม่สำเร็จ');
    } finally { setLoading(false); }
  }, [applicationId, toast]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  // Debounced manual student search within this school.
  useEffect(() => {
    if (!searchFor || searchQ.trim().length < 2) { setSearchResults([]); return undefined; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get('/school/students', { params: { search: searchQ.trim(), per_page: 10 } });
        setSearchResults(Array.isArray(res?.data?.data) ? res.data.data : []);
      } catch { setSearchResults([]); } finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [searchQ, searchFor]);

  function closeSearch() { setSearchFor(null); setSearchQ(''); setSearchResults([]); }

  async function doMatch(rosterId, matchedStudentId) {
    if (busyId) return;
    setBusyId(rosterId);
    try {
      await api.post(`/school/registrations/${applicationId}/students/${rosterId}/match`, { matched_student_id: matchedStudentId });
      toast.success('จับคู่นักเรียนแล้ว');
      closeSearch();
      fetchDetail();
    } catch (err) {
      toast.error(err.response?.data?.message || 'จับคู่ไม่สำเร็จ');
    } finally { setBusyId(null); }
  }

  async function markNotFound(rosterId) {
    if (busyId) return;
    setBusyId(rosterId);
    try {
      await api.patch(`/school/registrations/${applicationId}/students/${rosterId}`, { match_status: 'NOT_FOUND' });
      toast.success('ทำเครื่องหมาย "ไม่ใช่เด็กที่นี่" แล้ว');
      fetchDetail();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สำเร็จ');
    } finally { setBusyId(null); }
  }

  async function approve() {
    if (approving) return;
    setApproving(true);
    try {
      await api.post(`/school/registrations/${applicationId}/approve`);
      toast.success('อนุมัติคำขอแล้ว');
      onBack();
    } catch (err) {
      toast.error(err.response?.data?.message || 'อนุมัติไม่สำเร็จ');
    } finally { setApproving(false); }
  }

  async function reject() {
    const reason = window.prompt('เหตุผลที่ส่งกลับให้แก้ไข:');
    if (reason == null) return;
    if (!reason.trim()) { toast.error('กรุณาระบุเหตุผล'); return; }
    setApproving(true);
    try {
      await api.post(`/school/registrations/${applicationId}/reject`, { reason });
      toast.success('ส่งกลับให้แก้ไขแล้ว');
      onBack();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สำเร็จ');
    } finally { setApproving(false); }
  }

  const roster = detail?.roster || [];
  const unmatched = roster.filter((r) => r.match_status === 'UNMATCHED').length;
  const canAct = !isTeacher && detail && detail.approval_status !== 'APPROVED';

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mb-4">
        <ArrowLeft className="w-4 h-4" /> กลับ
      </button>

      {loading ? (
        <LoadingState />
      ) : !detail ? (
        <p className="text-gray-400 py-10 text-center">ไม่พบข้อมูล</p>
      ) : (
        <>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-lg font-bold text-gray-800">เด็กที่คนขับแจ้ง ({roster.length})</h1>
              {unmatched > 0 && <p className="text-xs text-amber-600">ยังมี {unmatched} คนที่ยังไม่ตรวจสอบ</p>}
            </div>
            <Pill status={detail.approval_status} />
          </div>

          <div className="space-y-2">
            {roster.map((r) => (
              <div key={r.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">
                      {r.raw_student_name}
                      {r.raw_grade ? <span className="text-gray-400 font-normal"> · {r.raw_grade}</span> : null}
                      {r.raw_student_code ? <span className="text-gray-400 font-normal"> · เลข {r.raw_student_code}</span> : null}
                    </p>
                    <p className="text-xs text-gray-500">{PICKUP_LABEL[r.pickup_type] || '-'}</p>
                  </div>
                  {r.match_status === 'MATCHED' && <span className="text-xs text-green-600 shrink-0">จับคู่แล้ว ✓</span>}
                  {r.match_status === 'NOT_FOUND' && <span className="text-xs text-gray-400 shrink-0">ไม่ใช่เด็กที่นี่</span>}
                </div>

                {r.match_status === 'UNMATCHED' && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    {/* high / medium → single suggestion */}
                    {r.suggestion && (r.suggestion.confidence === 'high' || r.suggestion.confidence === 'medium') && r.suggestion.student && (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-gray-600">
                          ระบบแนะนำ: <span className="font-medium text-gray-800">{r.suggestion.student.full_name}</span>
                          {r.suggestion.student.grade ? ` (${r.suggestion.student.grade})` : ''}
                          <span className="text-gray-400"> · {r.suggestion.confidence === 'high' ? 'ตรงเลขประจำตัว' : 'ใกล้เคียง'}</span>
                        </p>
                        {canAct && (
                          <button onClick={() => doMatch(r.id, r.suggestion.student.id)} disabled={busyId === r.id}
                            className="text-xs font-medium bg-green-50 border border-green-300 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-100 disabled:opacity-50 whitespace-nowrap">
                            <Check className="w-3.5 h-3.5 inline -mt-0.5" /> ยืนยัน
                          </button>
                        )}
                      </div>
                    )}

                    {/* ambiguous → choose from candidates */}
                    {r.suggestion && r.suggestion.confidence === 'ambiguous' && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1.5">มีหลายคนใกล้เคียง เลือกคนที่ถูกต้อง:</p>
                        <div className="space-y-1.5">
                          {(r.suggestion.candidates || []).map((c) => (
                            <div key={c.id} className="flex items-center justify-between gap-2">
                              <span className="text-xs text-gray-700">{c.full_name}{c.grade ? ` (${c.grade})` : ''}</span>
                              {canAct && (
                                <button onClick={() => doMatch(r.id, c.id)} disabled={busyId === r.id}
                                  className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50">เลือก</button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* none */}
                    {(!r.suggestion || r.suggestion.confidence === 'none') && (
                      <p className="text-xs text-gray-400 mb-2">ไม่พบนักเรียนที่ตรงกันอัตโนมัติ</p>
                    )}

                    {canAct && searchFor === r.id ? (
                      <div className="mt-2">
                        <input autoFocus value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
                          placeholder="พิมพ์ชื่อหรือรหัสนักเรียน…"
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400" />
                        {searching && <p className="text-xs text-gray-400 mt-1">กำลังค้นหา…</p>}
                        <div className="space-y-1 mt-1.5 max-h-40 overflow-auto">
                          {searchResults.map((s) => (
                            <div key={s.id} className="flex items-center justify-between gap-2">
                              <span className="text-xs text-gray-700">
                                {(s.prefix || '')}{s.first_name} {s.last_name}
                                {s.grade ? ` (${s.grade})` : ''}{s.student_code ? ` · ${s.student_code}` : ''}
                              </span>
                              <button onClick={() => doMatch(r.id, s.id)} disabled={busyId === r.id}
                                className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50">เลือก</button>
                            </div>
                          ))}
                          {searchQ.trim().length >= 2 && !searching && searchResults.length === 0 && (
                            <p className="text-xs text-gray-400">ไม่พบนักเรียน</p>
                          )}
                        </div>
                        <button onClick={closeSearch} className="text-xs text-gray-400 mt-1">ยกเลิกค้นหา</button>
                      </div>
                    ) : canAct && (
                      <div className="mt-2 flex items-center gap-4">
                        <button onClick={() => { closeSearch(); setSearchFor(r.id); }}
                          className="text-xs text-blue-600 hover:text-blue-800">
                          <Search className="w-3.5 h-3.5 inline -mt-0.5" /> ค้นหาเอง
                        </button>
                        <button onClick={() => markNotFound(r.id)} disabled={busyId === r.id}
                          className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50">
                          <X className="w-3.5 h-3.5 inline -mt-0.5" /> ไม่ใช่เด็กของโรงเรียนนี้
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Vehicle + driver evidence documents */}
          <DocumentReview vehicleId={detail.vehicle_id} driverId={detail.driver_id} canReview={!isTeacher} />

          {/* Action bar */}
          {canAct && (
            <div className="flex gap-3 mt-6 sticky bottom-0 bg-gradient-to-t from-white pt-4">
              <button onClick={approve} disabled={approving || unmatched > 0}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-3 rounded-lg transition flex items-center justify-center gap-1">
                <ClipboardCheck className="w-4 h-4" />
                {unmatched > 0 ? `ตรวจให้ครบก่อน (เหลือ ${unmatched})` : 'อนุมัติทั้งหมด'}
              </button>
              <button onClick={reject} disabled={approving}
                className="bg-red-50 border border-red-300 text-red-700 hover:bg-red-100 disabled:opacity-50 text-sm font-medium px-5 py-3 rounded-lg transition">
                ส่งกลับแก้ไข
              </button>
            </div>
          )}
          {isTeacher && (
            <p className="text-xs text-gray-400 text-center mt-6">บัญชีครูประจำสายชั้นดูได้อย่างเดียว</p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Document review (vehicle papers + driver licence the driver attached) ───
const DOC_LABEL = {
  VEHICLE_REGISTRATION: 'เล่มทะเบียนรถ', COMPULSORY_INSURANCE: 'พ.ร.บ.', TAX: 'ป้ายภาษีรถ',
  INSURANCE: 'ประกันภัยรถ', DRIVER_LICENCE: 'ใบขับขี่', OTHER: 'เอกสารอื่น ๆ',
};
const DOC_REVIEW = {
  PENDING: { label: 'รอตรวจ', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  APPROVED: { label: 'ผ่าน', cls: 'bg-green-50 text-green-700 border-green-200' },
  REJECTED: { label: 'ไม่ผ่าน', cls: 'bg-red-50 text-red-700 border-red-200' },
};

function DocReviewPill({ status }) {
  const r = DOC_REVIEW[status] || DOC_REVIEW.PENDING;
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${r.cls}`}>{r.label}</span>;
}

function DocumentReview({ vehicleId, driverId, canReview }) {
  const toast = useToast();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [v, d] = await Promise.all([
        vehicleId ? api.get(`/school/registrations/documents/vehicle/${vehicleId}`) : Promise.resolve(null),
        driverId ? api.get(`/school/registrations/documents/driver/${driverId}`) : Promise.resolve(null),
      ]);
      const vd = Array.isArray(v?.data?.data) ? v.data.data.map((x) => ({ ...x, kind: 'vehicle' })) : [];
      const dd = Array.isArray(d?.data?.data) ? d.data.data.map((x) => ({ ...x, kind: 'driver' })) : [];
      setDocs([...vd, ...dd]);
    } catch { setDocs([]); } finally { setLoading(false); }
  }, [vehicleId, driverId]);
  useEffect(() => { load(); }, [load]);

  async function view(kind, id) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await api.get(`/documents/${kind}/${id}/file`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error('เปิดเอกสารไม่ได้');
    } finally { setBusyId(null); }
  }

  async function review(kind, id, decision) {
    let note = null;
    if (decision === 'REJECTED') {
      note = window.prompt('เหตุผลที่ไม่ผ่าน (เช่น เอกสารเบลอ / หมดอายุ):');
      if (note == null) return;
      if (!note.trim()) { toast.error('กรุณาระบุเหตุผล'); return; }
    }
    setBusyId(id);
    try {
      await api.post(`/school/registrations/documents/${kind}/${id}/review`, { decision, note });
      toast.success(decision === 'APPROVED' ? 'อนุมัติเอกสารแล้ว' : 'ทำเครื่องหมายไม่ผ่านแล้ว');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'ไม่สำเร็จ');
    } finally { setBusyId(null); }
  }

  return (
    <div className="mt-6">
      <div className="flex items-center gap-1.5 mb-2">
        <FileText className="w-4 h-4 text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-700">เอกสารรถและคนขับ</h2>
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 py-2">กำลังโหลดเอกสาร…</p>
      ) : docs.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">คนขับยังไม่ได้แนบเอกสาร</p>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <div key={`${d.kind}-${d.id}`} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{DOC_LABEL[d.doc_type] || 'เอกสาร'}</p>
                  <p className="text-xs text-gray-500 truncate">{d.original_name || '-'}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <DocReviewPill status={d.review_status} />
                    {d.expiry_date && (
                      <span className="text-xs text-gray-400">หมดอายุ {String(d.expiry_date).split('T')[0]}</span>
                    )}
                  </div>
                  {d.review_status === 'REJECTED' && d.review_note && (
                    <p className="text-xs text-red-600 mt-1">เหตุผล: {d.review_note}</p>
                  )}
                </div>
                <button onClick={() => view(d.kind, d.id)} disabled={busyId === d.id}
                  className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50 whitespace-nowrap">
                  <Eye className="w-3.5 h-3.5 inline -mt-0.5" /> ดูไฟล์
                </button>
              </div>

              {canReview && (
                <div className="mt-2.5 pt-2.5 border-t border-gray-100 flex items-center gap-3">
                  <button onClick={() => review(d.kind, d.id, 'APPROVED')} disabled={busyId === d.id}
                    className="text-xs font-medium bg-green-50 border border-green-300 text-green-700 px-3 py-1.5 rounded-lg hover:bg-green-100 disabled:opacity-50">
                    <Check className="w-3.5 h-3.5 inline -mt-0.5" /> ผ่าน
                  </button>
                  <button onClick={() => review(d.kind, d.id, 'REJECTED')} disabled={busyId === d.id}
                    className="text-xs font-medium text-gray-500 hover:text-red-600 disabled:opacity-50">
                    <X className="w-3.5 h-3.5 inline -mt-0.5" /> ไม่ผ่าน
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
