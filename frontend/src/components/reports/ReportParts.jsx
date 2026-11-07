import { getGradeScope } from '../../utils/authScope';

/**
 * Shared pieces of the report pages (daily / monthly / summary), local to the
 * reports area: the scope-named hero, the export panel wrapper and the section
 * heading. Presentation only, no data or scope logic.
 */

/**
 * Name of whose numbers the report shows. The server already filters every
 * figure to the caller's scope, so this only labels it:
 *   school           the school's own name (one school in the data), else the account name
 *   grade teacher    school name + ชั้น
 *   affiliation / province / admin   the account display name
 */
export function reportScopeName(user, data) {
  const schools = Array.isArray(data?.schools) ? data.schools : [];
  const own = user?.role === 'school' && schools.length === 1 ? schools[0].school_name : null;
  const base = own || user?.display_name || (user?.role === 'province' || user?.role === 'admin' ? 'ภาพรวมจังหวัด' : 'รายงานรถรับส่งนักเรียน');
  const grade = getGradeScope(user);
  return grade ? `${base} · ชั้น ${grade}` : base;
}

/** Navy hero: report kind, whose numbers, which date; the date control sits on the right. */
export function ReportHero({ eyebrow, title, subtitle, children }) {
  return (
    <div className="bg-navy-700 text-white rounded-2xl px-4 sm:px-5 py-4 mb-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-navy-200">{eyebrow}</p>
          <h1 className="text-xl sm:text-2xl font-bold leading-snug text-pretty">{title}</h1>
          {subtitle && <p className="text-base text-navy-100 mt-0.5">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** A report section: plain heading + optional one-line hint, content below. */
export function ReportSection({ title, hint, children, className = '' }) {
  return (
    <section className={`mb-6 ${className}`}>
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      {hint ? <p className="text-sm text-ink-muted mt-0.5 mb-3">{hint}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

/** Export buttons grouped under one label that says what the files contain. */
export function ExportPanel({ title = 'ดาวน์โหลดรายงาน', note, children, stamp = true }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-surface-border bg-surface-raised p-4 sm:p-5 mt-6">
      <h2 className="text-lg font-bold text-ink">{title}</h2>
      {note && <p className="text-sm text-ink-muted mt-0.5">{note}</p>}
      <div className="mt-1">{children}</div>
      {stamp && (
        <p className="text-sm text-ink-muted mt-3">
          สร้างจากระบบรถรับส่งนักเรียนจังหวัดลำปาง · {new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
        </p>
      )}
    </section>
  );
}
