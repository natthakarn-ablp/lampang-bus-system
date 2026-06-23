export default function CommandHero({
  eyebrow,
  title,
  description,
  icon: Icon,
  actions,
  meta,
  children,
  className = '',
}) {
  return (
    <section
      className={`relative overflow-hidden rounded-2xl bg-blue-950 text-white shadow-elevate motion-safe:animate-fade-in-up motion-reduce:animate-none ${className}`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-blue-300/40" aria-hidden="true" />
      <div className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-blue-500/20 blur-3xl" aria-hidden="true" />
      <div className="absolute -left-20 bottom-0 h-44 w-44 rounded-full bg-sky-400/10 blur-3xl" aria-hidden="true" />

      <div className="relative p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <div className="flex items-center gap-2 text-blue-100">
              {Icon && (
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-blue-100">
                  <Icon className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
                </span>
              )}
              {eyebrow && <p className="text-xs font-semibold text-blue-200">{eyebrow}</p>}
            </div>

            <h1 className="mt-3 text-2xl font-bold leading-tight text-balance sm:text-3xl">
              {title}
            </h1>
            {description && (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100 text-pretty sm:text-base">
                {description}
              </p>
            )}
            {meta && (
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-blue-100">
                {Array.isArray(meta)
                  ? meta.map(item => (
                    <span key={String(item)} className="rounded-full bg-white/10 px-3 py-1">
                      {item}
                    </span>
                  ))
                  : <span className="rounded-full bg-white/10 px-3 py-1">{meta}</span>}
              </div>
            )}
          </div>

          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>

        {children && <div className="mt-5">{children}</div>}
      </div>
    </section>
  );
}
