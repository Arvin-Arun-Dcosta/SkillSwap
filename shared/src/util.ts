import { TIME_SLOTS, type TimeSlotId } from './constants';

/** Escapes a string so it can be embedded in a regular expression as a literal. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One or two uppercase initials for a display name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function timeSlotLabel(id: TimeSlotId): string {
  return TIME_SLOTS.find((slot) => slot.id === id)?.label ?? id;
}

/** Rounds to one decimal place, the precision ratings are shown with. */
export function roundRating(value: number): number {
  return Math.round(value * 10) / 10;
}
