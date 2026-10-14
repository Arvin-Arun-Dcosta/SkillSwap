import { type ReactNode, useId, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Small, dependency-free charts for the admin overview. They follow a few fixed rules: thin marks
 * with a rounded data end, a hairline baseline, values in text colours (never the series colour),
 * a hover and keyboard-focus readout, and a table view so no value is only reachable by pointing.
 */

function TableToggle({ children }: { children: ReactNode }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="inline-flex min-h-9 items-center font-semibold text-primary">
        View as table
      </summary>
      <div className="mt-2 overflow-x-auto">{children}</div>
    </details>
  );
}

const cell = 'border-b border-border px-2 py-1.5 text-left tabular-nums';

/** Columns over time for one measure. One series, so the title names it and there is no legend. */
export function ColumnChart({
  title,
  points,
  unit,
}: {
  title: string;
  points: { label: string; longLabel: string; value: number }[];
  /** Singular noun for the readout, for example "sign-up". */
  unit: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const max = Math.max(1, ...points.map((p) => p.value));
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const focused = active !== null ? points[active] : undefined;
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span id={titleId} className="text-sm font-semibold">
          {title}
        </span>
        <span className="text-sm text-muted">
          <span className="font-bold text-text">{total}</span> in {points.length} days
        </span>
      </figcaption>

      <div className="mt-3 flex gap-2">
        <div
          className="flex h-32 flex-col justify-between text-right text-xs text-muted tabular-nums"
          aria-hidden="true"
        >
          <span>{max}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          {/*
            Keyboard access is one native slider per chart: arrow keys step through the days and
            the reading is announced. Individual columns are too narrow to be fair targets.
          */}
          <input
            type="range"
            min={0}
            max={points.length - 1}
            step={1}
            value={active ?? points.length - 1}
            aria-label={`${title}: day`}
            aria-valuetext={
              focused
                ? `${focused.longLabel}: ${focused.value} ${focused.value === 1 ? unit : `${unit}s`}`
                : undefined
            }
            onChange={(event) => setActive(Number(event.target.value))}
            onFocus={() => setActive((current) => current ?? points.length - 1)}
            onBlur={() => setActive(null)}
            className="peer sr-only"
          />
          <ul
            aria-labelledby={titleId}
            onPointerLeave={() => setActive(null)}
            className="flex h-32 items-end gap-0.5 rounded-sm border-b border-border-strong peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-(--focus)"
          >
            {points.map((point, index) => (
              // The whole slot reacts to the pointer, not just the painted column.
              <li
                key={point.longLabel}
                onPointerEnter={() => setActive(index)}
                className="flex h-full min-w-0 flex-1 items-end justify-center"
              >
                <span
                  className={cn(
                    'w-full max-w-6 rounded-t-[4px] bg-chart-1 transition-opacity',
                    active !== null && active !== index && 'opacity-45',
                  )}
                  style={{
                    height:
                      point.value === 0 ? '2px' : `${Math.max(4, (point.value / max) * 100)}%`,
                  }}
                />
                <span className="sr-only">
                  {point.longLabel}: {point.value} {point.value === 1 ? unit : `${unit}s`}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex justify-between text-xs text-muted" aria-hidden="true">
            <span>{first?.label}</span>
            <span>{last?.label}</span>
          </div>
          <p className="mt-1 min-h-5 text-sm" aria-hidden="true">
            {focused ? (
              <>
                <span className="font-bold tabular-nums">{focused.value}</span>{' '}
                <span className="text-muted">
                  {focused.value === 1 ? unit : `${unit}s`} on {focused.longLabel}
                </span>
              </>
            ) : (
              <span className="text-muted" aria-hidden="true">
                Point at a column for the day&rsquo;s count.
              </span>
            )}
          </p>
        </div>
      </div>

      <TableToggle>
        <table className="w-full border-collapse">
          <caption className="sr-only">{title} per day</caption>
          <thead>
            <tr>
              <th scope="col" className={cell}>
                Day
              </th>
              <th scope="col" className={cell}>
                {title}
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.longLabel}>
                <th scope="row" className={cn(cell, 'font-normal')}>
                  {point.longLabel}
                </th>
                <td className={cell}>{point.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableToggle>
    </figure>
  );
}

/** Two measures per category as paired horizontal bars, with a legend and values at the bar tips. */
export function PairedBarChart({
  title,
  rows,
  seriesA,
  seriesB,
}: {
  title: string;
  rows: { label: string; a: number; b: number }[];
  seriesA: string;
  seriesB: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const titleId = useId();
  const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]));
  const width = (value: number) => (value === 0 ? '2px' : `${Math.max(1.5, (value / max) * 100)}%`);

  return (
    <figure className="min-w-0">
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span id={titleId} className="text-sm font-semibold">
          {title}
        </span>
        {/* Two series, so the legend is always shown; identity never rests on colour alone. */}
        <ul className="flex gap-4 text-sm text-muted" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[2px] bg-chart-1" aria-hidden="true" />
            {seriesA}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-[2px] bg-chart-2" aria-hidden="true" />
            {seriesB}
          </li>
        </ul>
      </figcaption>

      <ul
        aria-labelledby={titleId}
        className="mt-4 flex flex-col gap-3"
        onPointerLeave={() => setActive(null)}
      >
        {rows.map((row) => (
          <li
            key={row.label}
            className={cn(
              'grid grid-cols-[minmax(5rem,9rem)_1fr] items-center gap-3 transition-opacity',
              active !== null && active !== row.label && 'opacity-55',
            )}
            onPointerEnter={() => setActive(row.label)}
          >
            <span className="truncate text-sm" title={row.label}>
              {row.label}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5 border-l border-border-strong">
              {(
                [
                  [row.a, 'bg-chart-1', seriesA],
                  [row.b, 'bg-chart-2', seriesB],
                ] as const
              ).map(([value, colour, series]) => (
                <div key={series} className="flex items-center gap-2">
                  <span
                    className={cn('h-3.5 rounded-r-[4px]', colour)}
                    style={{ width: width(value), maxWidth: 'calc(100% - 2rem)' }}
                    aria-hidden="true"
                  />
                  <span className="text-xs font-semibold tabular-nums">
                    {value}
                    <span className="sr-only"> {series}</span>
                  </span>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <TableToggle>
        <table className="w-full border-collapse">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col" className={cell}>
                Skill
              </th>
              <th scope="col" className={cell}>
                {seriesA}
              </th>
              <th scope="col" className={cell}>
                {seriesB}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className={cn(cell, 'font-normal')}>
                  {row.label}
                </th>
                <td className={cell}>{row.a}</td>
                <td className={cell}>{row.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableToggle>
    </figure>
  );
}
