import { AlertTriangle, Loader2, Star } from 'lucide-react';
import { type HTMLAttributes, type ReactNode, useState } from 'react';
import { initials } from '@skillswap/shared';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-surface p-4 sm:p-6', className)}
      {...rest}
    />
  );
}

export function SectionHeading({
  title,
  description,
  action,
  as: Tag = 'h2',
  id,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  as?: 'h1' | 'h2' | 'h3';
  /** Id of the heading element, for `aria-labelledby` on the surrounding section. */
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <Tag
          id={id}
          className={Tag === 'h1' ? 'text-2xl font-bold sm:text-3xl' : 'text-lg font-bold'}
        >
          {title}
        </Tag>
        {description && <p className="mt-1 text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'teach' | 'learn';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-text',
  primary: 'bg-teach-bg text-teach',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  teach: 'bg-teach-bg text-teach',
  learn: 'bg-learn-bg text-learn',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-semibold',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const AVATAR_TONES = [
  'bg-teach-bg text-teach',
  'bg-learn-bg text-learn',
  'bg-success-bg text-success',
  'bg-warning-bg text-warning',
  'bg-surface-2 text-text',
];

const avatarSizes = {
  sm: 'size-8 text-xs',
  md: 'size-11 text-sm',
  lg: 'size-16 text-xl',
  xl: 'size-24 text-3xl',
};

/** A member's picture, falling back to initials on a colour derived from their id. */
export function Avatar({
  user,
  size = 'md',
  online,
  className,
}: {
  user: { id: string; name: string; avatar: string };
  size?: keyof typeof avatarSizes;
  /** Shows a presence dot. Leave undefined where presence is not relevant. */
  online?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = user.avatar !== '' && !failed;
  const tone =
    AVATAR_TONES[[...user.id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <span className={cn('relative inline-flex w-fit shrink-0', className)}>
      {showImage ? (
        <img
          src={user.avatar}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className={cn('rounded-full bg-surface-2 object-cover', avatarSizes[size])}
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex items-center justify-center rounded-full font-bold',
            avatarSizes[size],
            tone,
          )}
        >
          {initials(user.name)}
        </span>
      )}
      {online !== undefined && (
        <span
          className={cn(
            'absolute bottom-0 right-0 size-3 rounded-full border-2 border-surface',
            online ? 'bg-success' : 'bg-border-strong',
          )}
        >
          <span className="sr-only">{online ? 'Online' : 'Offline'}</span>
        </span>
      )}
    </span>
  );
}

export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-muted', className)}>
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Full-area loading state for route transitions. */
export function PageLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-[50dvh] items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('animate-skeleton rounded-md bg-surface-2', className)} />
  );
}

/** A list of card-shaped placeholders that matches the layout it stands in for. */
export function SkeletonList({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-4">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn('h-28 w-full rounded-lg', className)} />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong px-6 py-10 text-center">
      {icon && (
        <span className="flex size-12 items-center justify-center rounded-full bg-surface-2 text-muted">
          {icon}
        </span>
      )}
      <h3 className="text-base font-bold">{title}</h3>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'That did not load',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-lg border border-danger/40 bg-danger-bg px-6 py-8 text-center"
    >
      <AlertTriangle className="size-6 text-danger" aria-hidden="true" />
      <h3 className="text-base font-bold">{title}</h3>
      <p className="max-w-md text-sm">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Inline message for form-level errors and notices. */
export function Notice({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'success' | 'warning' | 'neutral';
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-md px-3.5 py-3 text-sm font-medium', tones[tone])}
    >
      {children}
    </div>
  );
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Read-only rating: a star, the number and how many reviews it is based on. */
export function Rating({
  value,
  count,
  className,
}: {
  value: number | null;
  count: number;
  className?: string;
}) {
  if (value === null || count === 0) {
    return <span className={cn('text-sm text-muted', className)}>No reviews yet</span>;
  }
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm font-semibold', className)}>
      <Star className="size-4 fill-current text-learn" aria-hidden="true" />
      <span>{value.toFixed(1)}</span>
      <span className="font-normal text-muted">
        ({count} {count === 1 ? 'review' : 'reviews'})
      </span>
    </span>
  );
}

/** Rating input as a radio group: works with keyboard arrows and screen readers out of the box. */
export function StarRatingInput({
  value,
  onChange,
  legend,
  error,
}: {
  value: number;
  onChange: (value: number) => void;
  legend: string;
  error?: string;
}) {
  const labels = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{legend}</legend>
      <div className="flex gap-1">
        {labels.map((label, index) => {
          const star = index + 1;
          return (
            <label
              key={star}
              className="cursor-pointer rounded-md p-1.5 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--focus)"
            >
              <input
                type="radio"
                name="rating"
                value={star}
                checked={value === star}
                onChange={() => onChange(star)}
                className="sr-only"
              />
              <Star
                aria-hidden="true"
                className={cn(
                  'size-8 transition-colors',
                  star <= value ? 'fill-current text-learn' : 'text-border-strong',
                )}
              />
              <span className="sr-only">
                {star} {star === 1 ? 'star' : 'stars'}: {label}
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-sm text-muted" aria-live="polite">
        {value > 0 ? labels[value - 1] : 'Choose 1 to 5 stars'}
      </p>
      {error && (
        <p className="mt-1 text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
