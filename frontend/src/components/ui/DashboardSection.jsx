import SectionTitle from './SectionTitle';

export default function DashboardSection({
  title,
  description,
  action,
  className = '',
  contentClassName = '',
  children,
}) {
  const showHeader = title || description || action;
  return (
    <section className={`flex flex-col gap-3 sm:gap-4 ${className}`}>
      {showHeader && <SectionTitle title={title} description={description} action={action} />}
      <div className={contentClassName}>{children}</div>
    </section>
  );
}
