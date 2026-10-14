import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  /** Small count shown after the label, for example unread items. */
  count?: number;
}

interface TabsProps<T extends string> {
  label: string;
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Id prefix shared with `tabPanelProps` so panels are linked to their tab. */
  idBase: string;
  className?: string;
  size?: 'sm' | 'md';
}

/** Accessible tab list with roving focus and arrow-key navigation. Scrolls sideways on overflow. */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  idBase,
  className,
  size = 'md',
}: TabsProps<T>) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent) => {
    const index = tabs.findIndex((t) => t.id === value);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onChange(target.id);
    refs.current.get(target.id)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        'flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]',
        className,
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) refs.current.set(tab.id, node);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={`${idBase}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 font-semibold transition-colors duration-150',
              size === 'sm' ? 'h-11 px-3 text-sm' : 'h-12 px-4 text-sm',
              selected
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-text',
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="rounded-full bg-surface-2 px-1.5 text-xs text-text">
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function tabPanelProps(idBase: string, id: string) {
  return {
    role: 'tabpanel' as const,
    id: `${idBase}-panel-${id}`,
    'aria-labelledby': `${idBase}-tab-${id}`,
    tabIndex: 0,
  };
}

export function useTabIds(): string {
  return useId();
}
