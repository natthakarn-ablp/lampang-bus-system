import { useEffect, useState } from 'react';
import { FileCheck2, ShieldCheck } from 'lucide-react';
import api from '../api/axios';
import PageHeader from '../components/PageHeader';
import LoadingState from '../components/LoadingState';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/ui/StatusBadge';

const CONTEXT_LABELS = {
  first_use: 'เมื่อเริ่มใช้ฉบับใหม่',
  'school.student_import_apply': 'ก่อนยืนยันนำเข้านักเรียน',
  'transport.inspection_create': 'ก่อนบันทึกผลตรวจรถ',
  'transport.inspection_update': 'ก่อนแก้ไขผลตรวจรถ',
  'transport.vehicle_export': 'ก่อนส่งออกรายงานรถ',
  'driver.shift_start': 'ก่อนเริ่มรอบรถ',
  'report.export': 'ก่อนดาวน์โหลดรายงาน',
  'admin.research_export': 'ก่อนส่งออกชุดข้อมูลวิจัย',
};

export default function PolicyCenter() {
  const [state, setState] = useState({ loading: true, error: '', enabled: false, policies: [] });

  function load() {
    setState((value) => ({ ...value, loading: true, error: '' }));
    api.get('/policy-notices/catalog')
      .then(({ data }) => setState({ loading: false, error: '', ...data.data }))
      .catch((err) => setState({
        loading: false, enabled: false, policies: [],
        error: err.response?.data?.message || 'โหลดนโยบายไม่สำเร็จ',
      }));
  }

  useEffect(load, []);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <PageHeader title="นโยบายและสิทธิของฉัน" subtitle="อ่านหัวข้อที่ตรงกับหน้าที่และดูว่าแต่ละข้อความจะแสดงเมื่อใด" />
      {state.reviewMode && <div role="status" className="rounded-2xl border border-warn-border bg-warn-soft p-4 text-sm leading-7 text-warn-ink">
        <p className="font-semibold">ใช้งานจริงเพื่อประชุมคณะทำงานวันที่ 21 ตุลาคม 2569</p>
        <p>เจ้าของระบบอนุมัติให้นำหน้าต่างนี้ขึ้นระบบจริงเพื่อทดสอบขั้นตอนและรับข้อเสนอแนะ การทำรายการยังเป็นข้อมูลจริงตามสิทธิ์เดิม ส่วนฐานกฎหมาย ระยะเวลาเก็บ ผู้ควบคุมข้อมูล และช่องทางติดต่อเป็นหัวข้อให้คณะทำงานกำหนดก่อนเปิดบันทึกหลักฐานรับทราบทางกฎหมาย</p>
      </div>}
      {state.loading ? <LoadingState /> : state.error ? <ErrorState message={state.error} onRetry={load} />
        : !state.enabled || state.policies.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="ยังไม่มีประกาศฉบับที่อนุมัติให้ใช้งาน"
            description="ระบบจะไม่แสดงหรือบันทึกการรับทราบจากข้อความร่าง เมื่อมีฉบับที่ผู้รับผิดชอบอนุมัติแล้วจะปรากฏในหน้านี้"
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {state.policies.map((policy) => (
              <article key={policy.key} className="rounded-2xl border border-surface-border bg-surface-raised p-5 shadow-soft">
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <FileCheck2 className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <StatusBadge variant={policy.kind === 'notice' ? 'info' : 'warn'} size="sm">
                    {policy.kind === 'certification' ? 'การรับรอง' : policy.kind === 'warning' ? 'คำเตือนก่อนทำรายการ' : 'ประกาศแจ้ง'}
                  </StatusBadge>
                </div>
                <h2 className="mt-4 text-base font-semibold text-ink">{policy.title}</h2>
                <p className="mt-2 text-sm leading-7 text-ink-muted">{policy.summary}</p>
                <ul className="mt-4 space-y-1.5 text-xs leading-6 text-ink-muted">
                  {policy.contexts.map((context) => <li key={context}>• {CONTEXT_LABELS[context] || context}</li>)}
                </ul>
                <div className="mt-4 border-t border-surface-border pt-4 text-xs leading-6 text-ink-muted">
                  <p><span className="font-semibold text-ink">ฐานการใช้ข้อมูล:</span> {policy.lawfulBasis || 'รอทีมกฎหมายและหน่วยงานกำหนด'}</p>
                  <p><span className="font-semibold text-ink">ระยะเวลาเก็บ:</span> {policy.retentionRule || 'รอทีมกฎหมายและหน่วยงานกำหนด'}</p>
                  {policy.acknowledgedAt && <p className="mt-1 text-success-ink">รับทราบฉบับนี้แล้ว</p>}
                </div>
                {policy.fullNoticeUrl && <a href={policy.fullNoticeUrl} target="_blank" rel="noopener noreferrer"
                  className="focus-ring mt-4 inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-700 underline underline-offset-2">
                  อ่านประกาศฉบับเต็ม
                </a>}
              </article>
            ))}
          </div>
        )}
    </div>
  );
}
