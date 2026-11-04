import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../hooks/useAuth';
import { isGradeTeacher } from '../../utils/authScope';
import { AppCard, AlertBanner, DataTable, FormField, ConfirmDialog } from '../../components/ui';

const SELECT = 'focus-ring w-full border border-surface-border bg-surface-raised rounded-lg px-3 min-h-[44px] text-base';
const PRIMARY = 'focus-ring min-h-[48px] px-4 rounded-lg bg-brand-600 text-white font-semibold disabled:opacity-50';

// Yearly promotion is started by hand by the school admin. Nothing here runs
// on a date. Step 1 previews (read-only); step 2 confirms in one transaction.
export default function SchoolYearPromotion() {
  const toast = useToast();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const isAdmin = user?.role === 'admin';
  const schoolId = params.get('school_id') || '';
  const [year, setYear] = useState('');
  const [plan, setPlan] = useState(null);
  const [excluded, setExcluded] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    if (isAdmin && !schoolId) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const q = new URLSearchParams();
      if (year) q.set('academic_year', year);
      if (isAdmin) q.set('school_id', schoolId);
      const res = await api.get(`/school/promotion/preview?${q}`);
      setPlan(res.data.data);
      setExcluded(new Set());
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดตัวอย่างการเลื่อนชั้นไม่สำเร็จ');
    } finally { setLoading(false); }
  }, [year, isAdmin, schoolId]);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const t = { promote: 0, graduate: 0, excluded: 0 };
    for (const r of plan?.rows || []) {
      for (const p of r.pupils) {
        if (excluded.has(p.id)) t.excluded += 1;
        else if (r.graduates) t.graduate += 1;
        else t.promote += 1;
      }
    }
    return t;
  }, [plan, excluded]);

  if (isGradeTeacher(user)) {
    return <div className="p-4 sm:p-6 max-w-3xl mx-auto"><AlertBanner variant="warn" title="ไม่มีสิทธิ์">การเลื่อนชั้นทำได้เฉพาะบัญชีหลักของโรงเรียน</AlertBanner></div>;
  }

  function toggle(id) {
    setExcluded((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function apply() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await api.post('/school/promotion/apply', {
        academic_year: plan.academic_year,
        excluded_student_ids: [...excluded],
        ...(isAdmin ? { school_id: schoolId } : {}),
      });
      setResult(res.data.data);
      setConfirming(false);
      toast.success('เลื่อนชั้นเรียบร้อยแล้ว');
      load();
    } catch (err) {
      setConfirming(false);
      toast.error(err.response?.data?.message || 'เลื่อนชั้นไม่สำเร็จ ยังไม่มีข้อมูลถูกเปลี่ยน');
    } finally { setSaving(false); }
  }

  const years = plan ? [plan.academic_year - 1, plan.academic_year, plan.academic_year + 1] : [];
  const locked = !plan || plan.already_promoted || (plan.rows.length === 0);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="เลื่อนชั้นปีการศึกษาใหม่" subtitle="ผู้ดูแลโรงเรียนกดเองปีละครั้ง ตรวจตัวอย่างและยกเว้นรายคนก่อนยืนยัน" />
      {isAdmin && !schoolId && <AlertBanner variant="warn" title="ต้องระบุโรงเรียน">เปิดหน้านี้พร้อม ?school_id=รหัสโรงเรียน</AlertBanner>}
      {error && <ErrorState message={error} onRetry={load} />}
      {loading && <LoadingState />}
      {plan && !loading && (
        <>
          <AppCard padding="lg">
            <div className="grid sm:grid-cols-2 gap-3 items-end">
              <FormField label="ปีการศึกษา (พ.ศ.)">{(ctl) => (
                <select {...ctl} className={SELECT} value={plan.academic_year} onChange={(e) => setYear(e.target.value)}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>)}
              </FormField>
              <p className="text-sm text-ink-muted">เลื่อน {totals.promote} คน · จบการศึกษา {totals.graduate} คน · ยกเว้น {totals.excluded} คน</p>
            </div>
          </AppCard>

          {plan.already_promoted && <AlertBanner variant="warn" title="เลื่อนชั้นปีการศึกษานี้ไปแล้ว">โรงเรียนนี้เลื่อนชั้นปี {plan.academic_year} เรียบร้อยแล้ว กดซ้ำไม่ได้</AlertBanner>}
          {result && <AlertBanner variant="success" title="เลื่อนชั้นสำเร็จ">เลื่อน {result.promoted} คน · จบ {result.graduated} คน · ยกเว้น {result.excluded} คน · อ่านชั้นไม่ได้ {result.unreadable} คน</AlertBanner>}

          <DataTable
            caption="ตัวอย่างการเลื่อนชั้น (ยังไม่มีการบันทึก)"
            rows={plan.rows}
            rowKey={(r) => r.from}
            columns={[
              { key: 'from', header: 'ชั้นเดิม', primary: true, cell: (r) => r.from },
              { key: 'to', header: 'ชั้นใหม่', cell: (r) => (r.graduates ? 'จบการศึกษา (นำออกจากรายชื่อและถอดรถ)' : r.to) },
              { key: 'count', header: 'จำนวนคน', align: 'center', cell: (r) => r.pupils.filter((p) => !excluded.has(p.id)).length + ' / ' + r.count },
            ]}
            empty={{ title: 'ไม่มีนักเรียนที่เลื่อนชั้นได้', description: 'ยังไม่มีรายชื่อนักเรียนปัจจุบันในโรงเรียนนี้' }}
          />

          {plan.rows.map((r) => (
            <details key={r.from} className="rounded-xl border border-surface-border p-3">
              <summary className="cursor-pointer min-h-[44px] flex items-center font-semibold">ยกเว้นรายคน · {r.from} ({r.count} คน)</summary>
              <ul className="mt-2 grid sm:grid-cols-2 gap-1">
                {r.pupils.map((p) => (
                  <li key={p.id}>
                    <label className="flex items-center gap-2 min-h-[44px]">
                      <input type="checkbox" className="w-5 h-5" checked={excluded.has(p.id)} onChange={() => toggle(p.id)} />
                      <span>{p.name} · รหัส {p.student_code ?? p.id}{p.classroom ? ` · ห้อง ${p.classroom}` : ''}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-ink-muted mt-2">ติ๊กเพื่อไม่เลื่อน (เช่น ซ้ำชั้น หรือย้ายออก) คนที่ติ๊กจะคงชั้นเดิมและรถเดิม</p>
            </details>
          ))}

          {plan.unreadable.length > 0 && (
            <AlertBanner variant="warn" title={`อ่านชั้นไม่ออก ${plan.unreadable.length} คน (จะไม่ถูกเลื่อน)`}>
              {plan.unreadable.map((p) => `${p.name} (${p.grade || 'ไม่ระบุ'})`).join(', ')} — แก้ชั้นที่หน้านักเรียนก่อน แล้วค่อยเลื่อนชั้น หรือแก้ภายหลังด้วยมือ
            </AlertBanner>
          )}

          <button type="button" className={PRIMARY} disabled={locked || saving} onClick={() => setConfirming(true)}>
            ตรวจแล้ว ยืนยันเลื่อนชั้นปี {plan.academic_year}
          </button>
        </>
      )}

      <ConfirmDialog
        open={confirming}
        title="ยืนยันเลื่อนชั้นปีการศึกษาใหม่?"
        itemName={plan ? `ปีการศึกษา ${plan.academic_year}` : ''}
        description={`เลื่อน ${totals.promote} คน · จบการศึกษา ${totals.graduate} คน (นำออกและถอดรถ) · ยกเว้น ${totals.excluded} คน — ทำได้ครั้งเดียวต่อปีการศึกษา และบันทึกใน audit log`}
        confirmLabel="ยืนยันเลื่อนชั้น"
        loading={saving}
        onConfirm={apply}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
