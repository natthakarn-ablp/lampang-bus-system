import { forwardRef } from 'react';

const PADDING = {
  none: '',
  sm:   'p-3',
  md:   'p-4',
  lg:   'p-6',
};

const AppCard = forwardRef(function AppCard({
  as: Tag = 'div',
  padding = 'lg',
  interactive = false,
  className = '',
  children,
  ...rest
}, ref) {
  // Opt-in hover lift for clickable cards (DESIGN.md: shadow appears on
  // interaction, not as decoration). Reduced-motion users keep a static card
  // via the global prefers-reduced-motion rule.
  const interactiveCls = interactive
    ? 'transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-elevate focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/25 cursor-pointer'
    : '';
  return (
    <Tag
      ref={ref}
      className={`bg-surface-raised border border-surface-border rounded-2xl shadow-soft ${PADDING[padding] || PADDING.lg} ${interactiveCls} ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
});

export default AppCard;
