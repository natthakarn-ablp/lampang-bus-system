import { useId } from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * FormField — label + control + helper/error, wired together.
 *
 * The per-page field wrappers this replaces shared the same three problems:
 * the <label> was not associated with its input (so clicking the label did
 * nothing and screen readers announced the control unlabelled), helper text
 * was not referenced by aria-describedby, and errors were rendered somewhere
 * else on the page rather than beside the field that caused them.
 *
 * Label sits above the control. Helper text never substitutes for a label —
 * a placeholder disappears the moment the user starts typing.
 *
 * Renders `children` when given (for selects, textareas or custom controls),
 * passing the wiring down via a render prop; otherwise renders an <input>.
 */
export default function FormField({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  error,
  helper,
  placeholder,
  disabled = false,
  autoComplete,
  inputMode,
  children,
  className = '',
  ...rest
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;
  const describedBy = [error ? errorId : null, helper ? helperId : null]
    .filter(Boolean).join(' ') || undefined;

  const controlProps = {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    'aria-required': required || undefined,
    disabled,
  };

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-ink mb-1">
        {label}
        {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
        {required && <span className="sr-only"> (จำเป็น)</span>}
      </label>

      {children ? children(controlProps) : (
        <input
          {...controlProps}
          type={type}
          value={value ?? ''}
          onChange={e => onChange?.(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          /* 16px so iOS does not zoom the viewport on focus */
          className={`focus-ring w-full bg-surface-raised border rounded-lg px-3 min-h-[44px] text-base text-ink placeholder:text-ink-muted transition disabled:opacity-60 disabled:bg-surface ${
            error ? 'border-danger' : 'border-surface-border'
          }`}
          {...rest}
        />
      )}

      {helper && !error && (
        <p id={helperId} className="mt-1 text-caption text-ink-muted">{helper}</p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-caption text-danger inline-flex items-start gap-1">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" strokeWidth={2.2} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}
