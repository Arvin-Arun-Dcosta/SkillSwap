import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, errorMessage } from './api';

/**
 * Puts field errors returned by the API onto the matching form fields. Returns a message for the
 * form as a whole when the error is not about a specific field shown in this form.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly Path<T>[],
): string | null {
  if (error instanceof ApiError && error.fields) {
    let matched = false;
    for (const [field, message] of Object.entries(error.fields)) {
      if ((knownFields as readonly string[]).includes(field)) {
        setError(field as Path<T>, { type: 'server', message });
        matched = true;
      }
    }
    if (matched) return null;
    const first = Object.values(error.fields)[0];
    if (first) return first;
  }
  return errorMessage(error);
}
