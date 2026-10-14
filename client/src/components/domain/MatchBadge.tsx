import { Check, ChevronDown } from 'lucide-react';
import type { MatchResult } from '@skillswap/shared';
import { Menu } from '@/components/ui';
import { cn } from '@/lib/cn';

function tone(score: number): string {
  if (score >= 75) return 'bg-success-bg text-success';
  if (score >= 45) return 'bg-teach-bg text-teach';
  return 'bg-surface-2 text-text';
}

/** The parts of a match score, as labelled meters plus the reasons in words. */
export function MatchBreakdown({ match }: { match: MatchResult }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2.5">
        {Object.entries(match.breakdown).map(([key, item]) => (
          <li key={key}>
            <p className="mb-1 flex justify-between text-sm">
              <span>{item.label}</span>
              <span className="font-semibold tabular-nums">
                {item.score}
                <span className="font-normal text-muted">
                  {' '}
                  <span aria-hidden="true">/</span>
                  <span className="sr-only">out of</span> {item.max}
                </span>
              </span>
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${(item.score / item.max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
      {match.reasons.length > 0 ? (
        <ul className="flex flex-col gap-1.5 border-t border-border pt-3">
          {match.reasons.map((reason) => (
            <li key={reason} className="flex gap-2 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              {reason}
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-border pt-3 text-sm text-muted">
          Your profiles do not overlap much yet.
        </p>
      )}
    </div>
  );
}

/** Compact score that opens the breakdown. */
export function MatchBadge({
  match,
  align = 'right',
}: {
  match: MatchResult;
  align?: 'left' | 'right';
}) {
  return (
    <Menu
      align={align}
      panelClassName="w-80 p-4"
      trigger={(props) => (
        <button
          type="button"
          className={cn(
            'inline-flex h-8 items-center gap-1 rounded-sm px-2 text-sm font-bold tabular-nums',
            tone(match.score),
          )}
          {...props}
        >
          {match.score}% match
          <ChevronDown className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Show why</span>
        </button>
      )}
    >
      {() => (
        <>
          <h3 className="mb-3 text-sm font-bold">Why {match.score}%</h3>
          <MatchBreakdown match={match} />
        </>
      )}
    </Menu>
  );
}
