import { type RefObject, useEffect, useId, useRef, useState } from 'react';

/** Calls `handler` when a pointer press or focus lands outside `ref`, or Escape is pressed. */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  handler: () => void,
): void {
  const saved = useRef(handler);
  useEffect(() => {
    saved.current = handler;
  });
  useEffect(() => {
    if (!active) return;
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) saved.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') saved.current();
    };
    const onFocus = (event: FocusEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) saved.current();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
    };
  }, [active, ref]);
}

/** Returns `value` after it has stayed unchanged for `delayMs`. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Sets the document title for the current page and restores nothing: the next page sets its own. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · SkillSwap` : 'SkillSwap: trade skills, learn together';
  }, [title]);
}

export { useId };
