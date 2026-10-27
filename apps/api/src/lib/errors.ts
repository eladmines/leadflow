import { defaultErrorMessages, type ErrorCode } from '@leadflow/shared';

const statusByCode: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

/** Expected, user-facing error. Anything else is treated as an internal error. */
export class AppError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: ErrorCode,
    message: string = defaultErrorMessages[code],
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.statusCode = statusByCode[code];
  }
}
