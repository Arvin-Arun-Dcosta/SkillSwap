import {
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useId,
} from 'react';
import { cn } from '@/lib/cn';

const control =
  'w-full rounded-md border border-border-strong bg-surface px-3 text-base text-text ' +
  'placeholder:text-muted/80 transition-colors duration-150 ' +
  'hover:border-text focus:border-primary disabled:opacity-60 ' +
  'aria-[invalid=true]:border-danger';

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string;
  /** Marks the label as optional instead of marking everything else as required. */
  optional?: boolean;
  hideLabel?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/** Label, hint and error wiring shared by every form control. */
export function FieldShell({
  label,
  hint,
  error,
  optional,
  hideLabel,
  className,
  children,
}: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={cn('text-sm font-semibold', hideLabel && 'sr-only')}>
        {label}
        {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </label>
      {children({ id, describedBy: describedBy || undefined, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type Shared = Pick<FieldShellProps, 'label' | 'hint' | 'error' | 'optional' | 'hideLabel'> & {
  wrapperClassName?: string;
};

export function Input({
  label,
  hint,
  error,
  optional,
  hideLabel,
  wrapperClassName,
  className,
  ref,
  ...rest
}: Shared & InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <FieldShell {...{ label, hint, error, optional, hideLabel }} className={wrapperClassName}>
      {({ id, describedBy, invalid }) => (
        <input
          ref={ref}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(control, 'h-11', className)}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function Textarea({
  label,
  hint,
  error,
  optional,
  hideLabel,
  wrapperClassName,
  className,
  ref,
  ...rest
}: Shared &
  TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: React.Ref<HTMLTextAreaElement> }) {
  return (
    <FieldShell {...{ label, hint, error, optional, hideLabel }} className={wrapperClassName}>
      {({ id, describedBy, invalid }) => (
        <textarea
          ref={ref}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(control, 'min-h-24 py-2.5', className)}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function Select({
  label,
  hint,
  error,
  optional,
  hideLabel,
  wrapperClassName,
  className,
  children,
  ref,
  ...rest
}: Shared & SelectHTMLAttributes<HTMLSelectElement> & { ref?: React.Ref<HTMLSelectElement> }) {
  return (
    <FieldShell {...{ label, hint, error, optional, hideLabel }} className={wrapperClassName}>
      {({ id, describedBy, invalid }) => (
        <select
          ref={ref}
          id={id}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(control, 'h-11 pr-8', className)}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}

interface ChoiceChipsProps<T extends string | number> {
  legend: string;
  hint?: string;
  error?: string;
  options: readonly { value: T; label: string; hint?: string }[];
  value: readonly T[];
  onChange: (next: T[]) => void;
  /** `single` behaves like radio buttons; `multiple` like checkboxes. */
  mode?: 'single' | 'multiple';
}

/** A group of toggleable chips backed by real checkboxes or radios, so it works with any input. */
export function ChoiceChips<T extends string | number>({
  legend,
  hint,
  error,
  options,
  value,
  onChange,
  mode = 'multiple',
}: ChoiceChipsProps<T>) {
  const name = useId();
  const toggle = (option: T) => {
    if (mode === 'single') return onChange([option]);
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = value.includes(option.value);
          return (
            <label
              key={String(option.value)}
              className={cn(
                'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3.5 text-sm font-medium',
                'transition-colors duration-150 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--focus)',
                checked
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-border-strong bg-surface text-text hover:bg-surface-2',
              )}
            >
              <input
                type={mode === 'single' ? 'radio' : 'checkbox'}
                name={name}
                className="sr-only"
                checked={checked}
                onChange={() => toggle(option.value)}
              />
              <span>{option.label}</span>
              {option.hint && (
                <span className={cn('text-xs', checked ? 'opacity-85' : 'text-muted')}>
                  {option.hint}
                </span>
              )}
            </label>
          );
        })}
      </div>
      {hint && !error && <p className="text-sm text-muted">{hint}</p>}
      {error && (
        <p className="text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
