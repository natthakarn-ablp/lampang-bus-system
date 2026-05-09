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
  className = '',
  children,
  ...rest
}, ref) {
  return (
    <Tag
      ref={ref}
      className={`bg-surface-raised border border-surface-border rounded-2xl shadow-soft ${PADDING[padding] || PADDING.lg} ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
});

export default AppCard;
