import { cn } from '@/lib/cn';

/** The swap mark: one arrow for what you teach, one for what you learn. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-9', className)} aria-hidden="true">
      <rect width="64" height="64" rx="14" className="fill-primary" />
      <path
        d="M18 25h26m0 0-8-8m8 8-8 8"
        fill="none"
        className="stroke-on-primary"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M46 41H20m0 0 8-8m-8 8 8 8"
        fill="none"
        stroke="#f3c583"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-xl font-extrabold tracking-tight">SkillSwap</span>
    </span>
  );
}
