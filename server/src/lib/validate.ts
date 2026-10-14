import type { z } from 'zod';
import { fieldErrors, objectIdSchema } from '@skillswap/shared';
import { notFound, validationFailed } from './errors';

/** Parses untrusted input with a schema, turning failures into a 400 with per-field messages. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) throw validationFailed(fieldErrors(result.error));
  return result.data;
}

/** Validates an id taken from the URL. A malformed id can never match a document, hence 404. */
export function parseId(value: unknown, what = 'Resource'): string {
  const result = objectIdSchema.safeParse(value);
  if (!result.success) throw notFound(what);
  return result.data;
}
