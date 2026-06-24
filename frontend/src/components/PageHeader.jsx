/**
 * PageHeader — consistent title header for dashboard/list pages.
 *
 * Props:
 *   title        — main page title (required)
 *   subtitle     — optional secondary line (e.g. school name)
 *   meta         — optional tertiary line (e.g. date)
 *   icon         — optional icon component rendered next to title
 *   iconColor    — gradient color for icon container (default blue)
 *   actions      — right-side actions (buttons, etc.)
 *   breadcrumb   — optional breadcrumb array [{ label, to }]
 */

import { Link } from 'react-router-dom';

// Solid token chip fills per tone — no decorative gradients (DESIGN.md).
// Each maps the iconColor prop to a single semantic/brand background; icon stays white.
const ICON_TONES = {
  blue:    'bg-brand-600',
  indigo:  'bg-brand-700',
  green:   'bg-success',
  amber:   'bg-warn',
  red:     'bg-danger',
  purple:  'bg-brand-800',
  sky:     'bg-info',
  teal:    'bg-info',
};

export default function PageHeader({
  title,
  subtitle,
  meta,
  icon: Icon,
  iconColor = 'blue',
  actions,
  breadcrumb,
}) {
  const toneClass = ICON_TONES[iconColor] || ICON_TONES.blue;

  return (
    <div className="mb-6 animate-fade-in-up">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="breadcrumb" className="mb-2 flex items-center gap-1.5 text-xs text-gray-500">
          {breadcrumb.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-gray-300">/</span>}
              {crumb.to ? (
                <Link to={crumb.to} className="hover:text-blue-600 transition">{crumb.label}</Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {Icon && (
            <div className={`w-11 h-11 rounded-xl ${toneClass} flex items-center justify-center shrink-0 text-white`}>
              <Icon className="w-6 h-6" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 leading-tight truncate">{title}</h1>
            {subtitle && (
              <p className="text-sm text-gray-600 mt-0.5 truncate">{subtitle}</p>
            )}
            {meta && (
              <p className="text-xs text-gray-400 mt-0.5">{meta}</p>
            )}
          </div>
        </div>

        {actions && (
          <div className="flex items-center gap-2 shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
