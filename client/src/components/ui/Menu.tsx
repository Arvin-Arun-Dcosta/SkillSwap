import { type ReactNode, useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { useDismiss } from '@/lib/hooks';

interface MenuProps {
  /** Renders the trigger. Spread `props` onto a button. */
  trigger: (props: {
    'aria-expanded': boolean;
    'aria-controls': string;
    'aria-haspopup': 'true';
    onClick: () => void;
  }) => ReactNode;
  /** Renders the panel content; call `close` after an item is chosen. */
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
  panelClassName?: string;
}

/** A disclosure panel anchored to its trigger. Closes on outside press, focus leaving, or Escape. */
export function Menu({ trigger, children, align = 'right', className, panelClassName }: MenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useDismiss(ref, open, () => setOpen(false));

  return (
    <div ref={ref} className={cn('relative', className)}>
      {trigger({
        'aria-expanded': open,
        'aria-controls': id,
        'aria-haspopup': 'true',
        onClick: () => setOpen((v) => !v),
      })}
      {open && (
        <div
          id={id}
          className={cn(
            'absolute top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] animate-pop-in rounded-lg border border-border bg-surface p-1.5 shadow-overlay',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export const menuItemClass =
  'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium hover:bg-surface-2';
