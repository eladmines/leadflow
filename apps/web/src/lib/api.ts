import { apiErrorBodySchema, defaultErrorMessages, type ErrorCode } from '@leadflow/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/**
 * Typed fetch wrapper. Sends cookies, the CSRF marker header, and JSON.
 * Every non-2xx response is converted into an ApiError with a Hebrew message.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-Requested-With', 'LeadFlow');
  // FormData (file uploads) sets its own multipart content type with the boundary.
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: 'include' });
  } catch {
    throw new ApiError(0, 'INTERNAL_ERROR', 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב');
  }

  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const parsed = apiErrorBodySchema.safeParse(data);
    if (parsed.success) {
      const { code, message, fields } = parsed.data.error;
      throw new ApiError(res.status, code, message, fields);
    }
    throw new ApiError(res.status, 'INTERNAL_ERROR', defaultErrorMessages.INTERNAL_ERROR);
  }
  return data as T;
}
