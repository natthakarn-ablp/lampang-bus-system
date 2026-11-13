import { useState, useEffect, useCallback } from 'react';
import { Landmark, Plus } from 'lucide-react';
import api from '../../api/axios';
import KpiCard from '../../components/KpiCard';
import PageHeader from '../../components/PageHeader';
import LoadingState from '../../components/LoadingState';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import { AppCard, StatusBadge, DataTable, TableAction, FormField, Modal } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { kpiColor, safePct, levelBadge, sortByKpi } from '../../utils/kpi';

export default function ProvAffiliationList() {
  const [affiliations, setAffiliations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const toast = useToast();
  // 2026-11-13 — province/admin add and rename สังกัด here (POST/PUT
  // /province/affiliations); previously only a database edit by the admin.
  const [modal, setModal] = useState(null); // { mode: 'create' } | { mode: 'rename', aff }
  const [form, setForm] = useState({ id: '', name: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return api.get('/province/affiliations')
      .then((res) => setAffiliations(Array.isArray(res.data.data) ? res.data.data : []))
      .catch((err) => setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setForm({ id: '', name: '' }); setModal({ mode: 'create' }); }
  function openRename(aff) { setForm({ id: aff.id, name: aff.name || '' }); setModal({ mode: 'rename', aff }); }
  async function save() {
    setSaving(true);
    try {
      const res = modal.mode === 'create'
        ? await api.post('/province/affiliations', { id: form.id.trim(), name: form.name })
        : await api.put(`/province/affiliations/${encodeURIComponent(modal.aff.id)}`, { name: form.name });
      toast.success(res.data?.message || 'บันทึกแล้ว');
      setModal(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally { setSaving(false); }
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="สังกัดทั้งหมด"
        subtitle="สรุปผลการดำเนินงานรายสังกัด · เพิ่มสังกัดใหม่และแก้ชื่อสังกัดได้ที่หน้านี้"
        actions={
          <button type="button" onClick={openCreate}
            className="focus-ring inline-flex items-center gap-1.5 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white font-medium px-4 min-h-[44px] rounded-lg transition text-sm">
            <Plus className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
            เพิ่มสังกัด
          </button>
        }
      />

      {error && <ErrorState message={error} className="mb-4" />}

      {loading ? (
        <LoadingState />
      ) : affiliations.length === 0 ? (
        <EmptyState title="ยังไม่มีสังกัด" />
      ) : (
        <>
          <DataTable
            className="mb-6"
            caption="สรุป KPI รายสังกัด"
            rows={sortByKpi(affiliations)}
            rowKey={a => a.id}
            columns={[
              { key: 'name', header: 'สังกัด', primary: true,
                cell: a => <span className="font-medium text-ink">{a.name}</span> },
              { key: 'schools',  header: 'โรงเรียน', numeric: true, cell: a => a.school_count },
              { key: 'students', header: 'นักเรียน', numeric: true, cell: a => (a.student_count ?? 0).toLocaleString('th-TH') },
              { key: 'vehicles', header: 'รถ',       numeric: true, cell: a => a.vehicle_count },
              { key: 'morning', header: 'KPI ส่งเช้า', align: 'center',
                cell: a => (
                  <div className={`font-medium ${kpiColor(a.morning_kpi)}`}>
                    <span className="tabular-nums">{safePct(a.morning_kpi)}</span>
                    <p className="text-caption text-ink-muted font-normal tabular-nums">{a.morning_done}/{a.morning_expected}</p>
                  </div>
                ) },
              { key: 'evening', header: 'KPI รับเย็น', align: 'center',
                cell: a => (
                  <div className={`font-medium ${kpiColor(a.evening_kpi)}`}>
                    <span className="tabular-nums">{safePct(a.evening_kpi)}</span>
                    <p className="text-caption text-ink-muted font-normal tabular-nums">{a.evening_done}/{a.evening_expected}</p>
                  </div>
                ) },
              { key: 'emergency', header: 'ฉุกเฉิน', numeric: true,
                cell: a => (
                  <span className={a.emergency_count > 0 ? 'text-danger-ink font-semibold' : 'text-ink-muted'}>
                    {a.emergency_count}
                  </span>
                ) },
              { key: 'level', header: 'ระดับ', align: 'center', badge: true,
                cell: a => {
                  const b = levelBadge(a.morning_kpi, a.evening_kpi);
                  return <StatusBadge variant={b.variant || 'neutral'}>{b.label}</StatusBadge>;
                } },
            ]}
            actions={a => <TableAction tone="brand" onClick={() => openRename(a)} aria-label={`แก้ชื่อสังกัด ${a.name}`}>แก้ชื่อ</TableAction>}
            empty={{ icon: Landmark, title: 'ยังไม่มีสังกัด' }}
          />

          {/* Per-affiliation KPI cards */}
          <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">KPI รายสังกัด</h2>
          <div className="grid gap-4">
            {sortByKpi(affiliations).map((a) => {
              const badge = levelBadge(a.morning_kpi, a.evening_kpi);
              return (
                <AppCard key={a.id} padding="md">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                    <div>
                      <h3 className="font-semibold text-ink">{a.name}</h3>
                      <p className="text-caption text-ink-muted tabular-nums">{a.school_count} โรงเรียน · {a.student_count} คน · {a.vehicle_count} คัน</p>
                    </div>
                    <span className="self-start"><StatusBadge variant={badge.variant || 'neutral'}>{badge.label}</StatusBadge></span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <KpiCard label="KPI ส่งเช้า" pct={a.morning_kpi}
                      detail={`${a.morning_done}/${a.morning_expected} คน`} />
                    <KpiCard label="KPI รับเย็น" pct={a.evening_kpi}
                      detail={`${a.evening_done}/${a.evening_expected} คน`} />
                    <div className="rounded-xl border border-surface-border p-4 bg-surface text-ink">
                      <p className="text-caption font-medium text-ink-muted">โรงเรียน</p>
                      <p className="text-2xl font-bold mt-1 tabular-nums">{a.school_count}</p>
                      <p className="text-caption mt-1 text-ink-muted tabular-nums">นักเรียน {a.student_count} คน</p>
                    </div>
                    <div className={`rounded-xl border p-4 ${a.emergency_count > 0 ? 'bg-danger-soft border-danger/30 text-danger-ink' : 'bg-surface border-surface-border text-ink'}`}>
                      <p className="text-caption font-medium opacity-80">เหตุฉุกเฉิน</p>
                      <p className="text-2xl font-bold mt-1 tabular-nums">{a.emergency_count}</p>
                      <p className="text-caption mt-1 opacity-80">{a.emergency_count > 0 ? 'ครั้ง วันนี้' : 'ไม่มี'}</p>
                    </div>
                  </div>
                </AppCard>
              );
            })}
          </div>
        </>
      )}

      <Modal
        open={Boolean(modal)}
        title={modal?.mode === 'create' ? 'เพิ่มสังกัด' : 'แก้ชื่อสังกัด'}
        size="sm"
        onClose={() => { if (!saving) setModal(null); }}
        footer={
          <>
            <button type="button" onClick={() => setModal(null)} disabled={saving}
              className="focus-ring text-base font-medium px-4 min-h-[44px] rounded-lg border border-surface-border text-ink hover:bg-surface transition disabled:opacity-50">ยกเลิก</button>
            <button type="submit" form="prov-affiliation-form" disabled={saving || !form.name.trim() || (modal?.mode === 'create' && !form.id.trim())}
              className="focus-ring text-base font-semibold px-4 min-h-[44px] rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition disabled:opacity-50">
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </>
        }
      >
        <form id="prov-affiliation-form" onSubmit={e => { e.preventDefault(); save(); }} className="space-y-3">
          {modal?.mode === 'create' ? (
            <FormField label="รหัสสังกัด" required value={form.id} maxLength={10}
              helper="อักษรอังกฤษหรือตัวเลข ไม่เกิน 10 ตัว เปลี่ยนภายหลังไม่ได้ เช่น LPG3"
              onChange={v => setForm({ ...form, id: v })} />
          ) : (
            <p className="text-sm text-ink-muted">รหัสสังกัด: <span className="font-mono">{form.id}</span></p>
          )}
          <FormField label="ชื่อสังกัด" required value={form.name} maxLength={200}
            onChange={v => setForm({ ...form, name: v })} />
          {modal?.mode === 'create' && (
            <p className="text-sm text-ink-muted">หลังเพิ่มสังกัด สร้างบัญชีผู้ใช้ของสังกัดได้ที่เมนู <strong>บัญชีสังกัดและขนส่ง</strong> และย้ายโรงเรียนเข้าสังกัดได้ที่เมนู <strong>โรงเรียนทั้งหมด</strong></p>
          )}
        </form>
      </Modal>
    </div>
  );
}
