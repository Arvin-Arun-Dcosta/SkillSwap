import type * as Y from 'yjs';

/** The smallest single replacement that turns `before` into `after`. */
export function diffText(
  before: string,
  after: string,
): { index: number; remove: number; insert: string } | null {
  if (before === after) return null;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return { index: start, remove: endBefore - start, insert: after.slice(start, endAfter) };
}

/** Applies what the member typed in a plain text box to the shared text as a minimal edit. */
export function applyTextChange(text: Y.Text, next: string): void {
  const change = diffText(text.toJSON(), next);
  if (!change) return;
  text.doc?.transact(() => {
    if (change.remove > 0) text.delete(change.index, change.remove);
    if (change.insert) text.insert(change.index, change.insert);
  });
}

type Delta = { retain?: number; insert?: unknown; delete?: number }[];

/** Where a caret at `position` ends up after a remote edit described by `delta`. */
export function transformPosition(position: number, delta: Delta): number {
  let index = 0;
  let result = position;
  for (const op of delta) {
    if (op.retain !== undefined) {
      index += op.retain;
    } else if (typeof op.insert === 'string') {
      if (index <= result) result += op.insert.length;
      index += op.insert.length;
    } else if (op.delete !== undefined) {
      if (index < result) result -= Math.min(op.delete, result - index);
    }
    if (index > result) break;
  }
  return Math.max(0, result);
}
