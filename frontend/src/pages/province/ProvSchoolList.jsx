import { useState, useEffect, useCallback } from 'react';
import { Building2 } from 'lucide-react';
import api from '../../api/axios';
import PageHeader from '../../components/PageHeader';
import ErrorState from '../../components/ErrorState';
import Pagination from '../../components/Pagination';
import { DataTable, FilterBar, TableAction, FormField, Modal, ConfirmDialog } from '../../components/ui';
import { useToast } from '../../components/Toast';

const SELECT_CLASS = 'focus-ring w-full bg-surface-raised border border-surface-border rounded-lg px-3 min-h-[44px] text-base text-ink transition';

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium' });
}

/**
 * โรงเรียนทั้งหมด (province + admin). Since 2026-11-13 also the place to
 * rename a school, move it to another สังกัด, deactivate it (blocked by the
 * server while it still has students or open inspection requests) and restore
 * it — PUT /province/schools/:id, POST .../deactivate, POST .../restore.
 */
export default function ProvSchoolList() {
  const toast = useToast();
  const [schools, setSchools] = useState([]);
  const [affiliations, setAffiliations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState({ page: 1, per_page: 50, total: 0 });
  const [affFilter, setAffFilter] = useState('');
  const [view, setView] = useState('active'); // 'active' | 'deactivated'

  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', affiliation_id: '' });
  const [confirm, setConfirm] = useState(null); // { kind: 'deactivate'|'restore', school }
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/province/affiliations')
      .then((res) => setAffiliations(Array.isArray(res.data.data) ? res.data.data : []))
      .catch(() => {});
  }, []);

  const fetchSchools = useCallback(async (page = 1) => {
    setLoading(true);
    setError('');
    try {
      if (view === 'deactivated') {
        const res = await api.get('/province/schools/deactivated');
        const rows = Array.isArray(res.data.data) ? res.data.data : [];
        setSchools(rows);
        setMeta({ page: 1, per_page: rows.length || 50, total: rows.length });
        return;
      }
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('per_page', '50');
      if (affFilter) params.set('affiliation_id', affFilter);

      const res = await api.get(`/province/schools?${params}`);
      setSchools(Array.isArray(res.data.data) ? res.data.data : []);
      setMeta(res.data.meta);
    } catch (err) {
      setError(err.response?.data?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [affFilter, view]);

  useEffect(() => {
    fetchSchools(1);
  }, [fetchSchools]);

  function openEdit(s) {
    setEditTarget(s);
    setEditForm({ name: s.name || '', affiliation_id: s.affiliation_id || '' });
  }
  async function saveEdit() {
    setSaving(true);
    try {
      const body = { name: editForm.name };
      if (editForm.affiliation_id && editForm.affiliation_id !== editTarget.affiliation_id) body.affiliation_id = editForm.affiliation_id;
      const res = await api.put(`/province/schools/${encodeURIComponent(editTarget.id)}`, body);
      toast.success(res.data?.message || 'บันทึกแล้ว');
      setEditTarget(null);
      fetchSchools(meta.page);
    } catch (err) {
      toast.error(err.response?.data?.message || 'บันทึกไม่สำเร็จ');
    } finally { setSaving(false); }
  }

  async function handleConfirm() {
    if (!confirm) return;
    const { kind, school } = confirm;
    setSaving(true);
    try {
      const res = kind === 'deactivate'
        ? await api.post(`/province/schools/${encodeURIComponent(school.id)}/deactivate`, { reason })
        : await api.post(`/province/schools/${encodeURIComponent(school.id)}/restore`);
      toast.success(res.data?.message || 'บันทึกแล้ว');
      setConfirm(null);
      fetchSchools(view === 'active' ? meta.page : 1);
    } catch (err) {
      toast.error(err.response?.data?.message || 'ทำรายการไม่สำเร็จ');
    } finally { setSaving(false); }
  }

  const isDeactivatedView = view === 'deactivated';
  const totalPages = Math.ceil(meta.total / meta.per_page) || 1;

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="โรงเรียนทั้งหมด"
        subtitle="โรงเรียนที่ใช้ระบบรถรับส่งในจังหวัด พร้อมจำนวนนักเรียนและรถ · แก้ชื่อ ย้ายสังกัด ปิดใช้งาน และกู้คืนโรงเรียนได้ที่หน้านี้"
      />

      <FilterBar
        className="mb-5"
        chips={{
          label: 'แสดงโรงเรียน',
          value: view,
          onChange: setView,
          options: [['active', 'ที่ใช้งานอยู่'], ['deactivated', 'ที่ปิดใช้งานแล้ว']],
        }}
        filters={isDeactivatedView ? [] : [{
          key: 'affiliation',
          label: 'กรองตามสังกัด',
          value: affFilter,
          onChange: setAffFilter,
          options: [['', 'ทุกสังกัด'], ...affiliations.map(a => [a.id, a.name])],
        }]}
        count={meta.total}
        countLabel="โรงเรียน"
        onClear={() => setAffFilter('')}
      />

      {error && <ErrorState message={error} className="mb-4" onRetry={() => fetchSchools(meta.page)} />}

      <DataTable
        caption={isDeactivatedView ? 'โรงเรียนที่ปิดใช้งานแล้ว' : 'รายชื่อโรงเรียนในจังหวัด'}
        loading={loading}
        rows={schools}
        rowKey={s => s.id}
        columns={isDeactivatedView ? [
          { key: 'name', header: 'โรงเรียน', primary: true,
            cell: s => <span className="font-medium text-ink">{s.name}</span> },
          { key: 'affiliation', header: 'สังกัด', secondary: true,
            cell: s => s.affiliation_name || '-' },
          { key: 'deleted_at', header: 'ปิดใช้งานเมื่อ', cell: s => formatDate(s.deleted_at) },
        ] : [
          { key: 'name', header: 'โรงเรียน', primary: true,
            cell: s => <span className="font-medium text-ink">{s.name}</span> },
          { key: 'affiliation', header: 'สังกัด', secondary: true,
            cell: s => s.affiliation_name || '-' },
          { key: 'students', header: 'นักเรียน', numeric: true,
            cell: s => `${(s.student_count ?? 0).toLocaleString('th-TH')} คน` },
          { key: 'vehicles', header: 'รถ', numeric: true,
            cell: s => `${(s.vehicle_count ?? 0).toLocaleString('th-TH')} คัน` },
        ]}
        actions={s => (isDeactivatedView ? (
          <TableAction tone="brand" onClick={() => setConfirm({ kind: 'restore', school: s })}>กู้คืน</TableAction>
        ) : (
          <>
            <TableAction tone="brand" onClick={() => openEdit(s)} aria-label={`แก้ไขโรงเรียน ${s.name}`}>แก้ไข/ย้ายสังกัด</TableAction>
            <TableAction tone="danger" onClick={() => { setReason(''); setConfirm({ kind: 'deactivate', school: s }); }}
              aria-label={`ปิดใช้งานโรงเรียน ${s.name}`}>ปิดใช้งาน</TableAction>
          </>
        ))}
        empty={{
          icon: Building2,
          title: isDeactivatedView ? 'ไม่มีโรงเรียนที่ปิดใช้งาน' : 'ไม่พบโรงเรียน',
          description: isDeactivatedView ? undefined : (affFilter ? 'ลองเลือกสังกัดอื่น' : 'ยังไม่มีโรงเรียนในระบบ'),
        }}
      />

      {!isDeactivatedView && totalPages > 1 && (
        <Pagination page={meta.page} totalPages={totalPages} total={meta.total} shown={schools.length} onPage={(p) => fetchSchools(p)} />
      )}

      <Modal
        open={Boolean(editTarget)}
        title="แก้ไขโรงเรียน"
        size="sm"
        onClose={() => { if (!saving) setEditTarget(null); }}
        footer={
          <>
            <button type="button" onClick={() => setEditTarget(null)} disabled={saving}
              className="focus-ring text-base font-medium px-4 min-h-[44px] rounded-lg border border-surface-border text-ink hover:bg-surface transition disabled:opacity-50">ยกเลิก</button>
            <button type="submit" form="prov-school-edit-form" disabled={saving || !editForm.name.trim()}
              className="focus-ring text-base font-semibold px-4 min-h-[44px] rounded-lg bg-brand-600 hover:bg-brand-700 text-white transition disabled:opacity-50">
              {saving ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
          </>
        }
      >
        <form id="prov-school-edit-form" onSubmit={e => { e.preventDefault(); saveEdit(); }} className="space-y-3">
          <p className="text-sm text-ink-muted">รหัสโรงเรียน: <span className="font-mono">{editTarget?.id}</span></p>
          <FormField label="ชื่อโรงเรียน" required value={editForm.name} maxLength={200}
            onChange={v => setEditForm({ ...editForm, name: v })} />
          <FormField label="สังกัด" helper="ย้ายสังกัดแล้ว สังกัดใหม่จะเห็นและดูแลโรงเรียนนี้แทนสังกัดเดิม">
            {(ctl) => (
              <select {...ctl} value={editForm.affiliation_id} onChange={e => setEditForm({ ...editForm, affiliation_id: e.target.value })} className={SELECT_CLASS}>
                {!editForm.affiliation_id && <option value="">— เลือกสังกัด —</option>}
                {affiliations.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
          </FormField>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.kind === 'restore' ? 'กู้คืนโรงเรียนนี้?' : 'ปิดใช้งานโรงเรียนนี้?'}
        itemName={confirm ? `${confirm.school.name} (${confirm.school.id})` : ''}
        description={confirm?.kind === 'restore'
          ? 'โรงเรียนจะกลับมาในรายการ บัญชีผู้ใช้ของโรงเรียนยังปิดอยู่ ให้สังกัดเปิดบัญชีที่เมนูจัดการผู้ใช้งานเมื่อพร้อม'
          : 'ปิดได้เฉพาะโรงเรียนที่ไม่มีนักเรียนที่ใช้งานอยู่และไม่มีคำขอตรวจสภาพรถค้าง บัญชีผู้ใช้ของโรงเรียนจะถูกปิดด้วย ข้อมูลไม่ถูกลบ กู้คืนได้ที่ "ที่ปิดใช้งานแล้ว"'}
        confirmLabel={confirm?.kind === 'restore' ? 'กู้คืน' : 'ปิดใช้งาน'}
        tone={confirm?.kind === 'restore' ? 'brand' : 'danger'}
        loading={saving}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      >
        {confirm?.kind === 'deactivate' && (
          <FormField label="เหตุผล (ถ้ามี)" value={reason} maxLength={500}
            onChange={setReason} placeholder="เช่น ยุบรวมกับโรงเรียนอื่น" />
        )}
      </ConfirmDialog>
    </div>
  );
}
