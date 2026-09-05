import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FilePlus2 } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../components/Toast';
import PageHeader from '../../components/PageHeader';
import { AlertBanner, FormField } from '../../components/ui';
import { CASE_TYPE_LABEL, LIMITS, SCOPE_TYPE_LABEL } from './constants';

/**
 * Submit a case.
 *
 * SCOPE IS NOT A FIELD FOR MOST PEOPLE. The API takes scope_type and scope_id
 * from the token for every role that has one, and ignores whatever the request
 * says — a school cannot file a case into another school by editing a form.
 * Only `admin` and `driver` have no scope of their own and must state one, so
 * the selector below appears for exactly those two roles. Showing it to
 * everyone would suggest a choice that does not exist.
 */

const SELF_SCOPED_ROLES = ['school', 'affiliation', 'province', 'transport'];

export default function ParticipationNewCase() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const needsScope = !SELF_SCOPED_ROLES.includes(user?.role);

  const [caseType, setCaseType] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [scopeType, setScopeType] = useState('');
  const [scopeId, setScopeId] = useState('');
  const [saving, setSaving] = useState(false);

  // PROVINCE is the whole province, so it is the one scope with no narrower id.
  const scopeIdRequired = needsScope && scopeType && scopeType !== 'PROVINCE';

  async function submit(e) {
    e.preventDefault();
    if (!caseType) { toast.error('กรุณาเลือกประเภทเรื่อง'); return; }
    if (!subject.trim()) { toast.error('กรุณากรอกหัวเรื่อง'); return; }
    if (needsScope && !scopeType) { toast.error('กรุณาเลือกขอบเขต'); return; }
    if (scopeIdRequired && !scopeId.trim()) { toast.error('กรุณาระบุรหัสหน่วยงานของขอบเขต'); return; }

    setSaving(true);
    try {
      const payload = { case_type: caseType, subject: subject.trim(), body: body.trim() || null };
      if (needsScope) {
        payload.scope_type = scopeType;
        if (scopeType !== 'PROVINCE') payload.scope_id = scopeId.trim();
      }
      const res = await api.post('/participation/cases', payload);
      toast.success(res.data.message || 'บันทึกเรื่องสำเร็จ');
      navigate(`/participation/cases/${res.data.data.id}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'บันทึกเรื่องไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto motion-safe:animate-fade-in-up motion-reduce:animate-none">
      <button
        type="button"
        onClick={() => navigate('/participation')}
        className="focus-ring mb-3 inline-flex items-center gap-1.5 min-h-[44px] px-3 -ml-3 rounded-lg text-sm text-ink-muted hover:text-ink hover:bg-surface transition"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        กลับไปรายการ
      </button>

      <PageHeader
        title="ยื่นเรื่องใหม่"
        subtitle="เรื่องที่ยื่นจะถูกบันทึกเป็นลำดับเหตุการณ์ที่แก้ย้อนหลังไม่ได้ ตั้งแต่รับเรื่องจนถึงแจ้งผลกลับ"
        icon={FilePlus2}
        iconColor="indigo"
      />

      <AlertBanner variant="info" title="สิ่งที่ไม่ควรใส่ในเรื่องนี้" className="mt-4">
        อย่าระบุชื่อนักเรียน เลขบัตรประชาชน เบอร์โทร หรือรหัสนักเรียน — บันทึกชุดนี้เป็นบันทึกเชิงการบริหาร
        ถ้าผูกกับตัวเด็กจะกลายเป็นข้อมูลเด็กซึ่งมีเงื่อนไขการเก็บต่างออกไป
      </AlertBanner>

      <form onSubmit={submit} className="mt-5 space-y-4">
        <FormField label="ประเภทเรื่อง" required>
          {(control) => (
            <select
              {...control}
              value={caseType}
              onChange={(e) => setCaseType(e.target.value)}
              className="focus-ring w-full min-h-[44px] px-3 rounded-lg border border-surface-border bg-surface-raised text-base text-ink"
            >
              <option value="">— เลือกประเภท —</option>
              {Object.entries(CASE_TYPE_LABEL).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          )}
        </FormField>

        <FormField
          label="หัวเรื่อง"
          required
          value={subject}
          onChange={(v) => setSubject(String(v).slice(0, LIMITS.SUBJECT))}
          helper={`${subject.length}/${LIMITS.SUBJECT} ตัวอักษร`}
          placeholder="สรุปสั้น ๆ ว่าเรื่องนี้คืออะไร"
        />

        <FormField label="รายละเอียด" helper={`${body.length}/${LIMITS.BODY} ตัวอักษร`}>
          {(control) => (
            <textarea
              {...control}
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, LIMITS.BODY))}
              rows={8}
              className="focus-ring w-full px-3 py-2 rounded-lg border border-surface-border bg-surface-raised text-base text-ink"
              placeholder="สิ่งที่เกิดขึ้น ผลกระทบ และสิ่งที่อยากให้พิจารณา"
            />
          )}
        </FormField>

        {needsScope ? (
          <>
            <FormField label="ขอบเขตของเรื่อง" required>
              {(control) => (
                <select
                  {...control}
                  value={scopeType}
                  onChange={(e) => { setScopeType(e.target.value); setScopeId(''); }}
                  className="focus-ring w-full min-h-[44px] px-3 rounded-lg border border-surface-border bg-surface-raised text-base text-ink"
                >
                  <option value="">— เลือกขอบเขต —</option>
                  {Object.entries(SCOPE_TYPE_LABEL).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
              )}
            </FormField>

            {scopeIdRequired && (
              <FormField
                label="รหัสหน่วยงาน"
                required
                value={scopeId}
                onChange={setScopeId}
                placeholder="เช่น SCH0001 หรือ AFF001"
                helper="รหัสของโรงเรียน สังกัด หรือหน่วยงานขนส่งที่เรื่องนี้เกี่ยวข้อง"
              />
            )}
          </>
        ) : (
          <p className="text-caption text-ink-muted">
            เรื่องนี้จะถูกบันทึกในขอบเขตของบัญชีที่คุณใช้อยู่โดยอัตโนมัติ — เลือกเองไม่ได้ และแก้ผ่านฟอร์มไม่ได้
          </p>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="focus-ring inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg bg-brand-700 hover:bg-brand-800 active:bg-brand-900 text-surface-raised text-sm font-semibold transition disabled:opacity-50 disabled:pointer-events-none"
          >
            {saving ? 'กำลังบันทึก…' : 'ยื่นเรื่อง'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/participation')}
            className="focus-ring inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg border border-surface-border bg-surface-raised text-sm font-medium text-ink hover:bg-surface transition"
          >
            ยกเลิก
          </button>
        </div>
      </form>
    </div>
  );
}
