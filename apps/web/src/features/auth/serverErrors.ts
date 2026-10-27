import { defaultErrorMessages } from '@leadflow/shared';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from '../../lib/api';

/** Hebrew text for any error that isn't mapped onto a field. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'RATE_LIMITED') return defaultErrorMessages.RATE_LIMITED;
    return err.message || defaultErrorMessages[err.code];
  }
  return defaultErrorMessages.INTERNAL_ERROR;
}

/**
 * Puts `ApiError.fields` onto the form's inline errors. Returns the message for a
 * form-level Alert, or `null` when every server error landed on a visible field.
 */
export function applyServerErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  formFields: readonly Path<T>[],
): string | null {
  if (!(err instanceof ApiError) || !err.fields) return errorMessage(err);

  let mapped = 0;
  let unmapped = 0;
  for (const [name, message] of Object.entries(err.fields)) {
    if ((formFields as readonly string[]).includes(name)) {
      setError(name as Path<T>, { type: 'server', message }, { shouldFocus: mapped === 0 });
      mapped += 1;
    } else {
      unmapped += 1;
    }
  }
  return mapped > 0 && unmapped === 0 ? null : errorMessage(err);
}
