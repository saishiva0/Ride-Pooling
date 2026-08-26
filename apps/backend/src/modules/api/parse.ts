/**
 * Shared HTTP plumbing (Phase 3.10): Zod request parsing.
 *
 * Validates HTTP input at the boundary (path params, query params, bodies)
 * and maps schema failures into the existing `ValidationError` (400)
 * architecture — controllers never see raw Zod results and the application
 * layer stays authoritative for business rules.
 */
import type { z } from 'zod';
import { ValidationError } from '../../lib/errors.js';

/**
 * Parses `value` against `schema`, returning the validated (and transformed)
 * data. Throws `ValidationError` (400) with the first issue's field path and
 * message, plus the full issue list in `details` for debugging.
 */
export function parseRequest<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new ValidationError(first?.message ?? 'Invalid request', {
      field: first?.path.length ? first.path.join('.') : undefined,
      details: { issues: result.error.issues },
    });
  }
  return result.data;
}
