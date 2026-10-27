import { z } from 'zod';

/**
 * Error codes shared by API and web. The web maps codes to Hebrew copy;
 * the API also sends a Hebrew `message` as a fallback.
 */
export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Consistent error body returned by every API endpoint. */
export const apiErrorBodySchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    /** Field path -> Hebrew message, for inline form errors. */
    fields: z.record(z.string()).optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

export const defaultErrorMessages: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'חלק מהשדות אינם תקינים',
  UNAUTHENTICATED: 'יש להתחבר כדי להמשיך',
  FORBIDDEN: 'אין לך הרשאה לבצע פעולה זו',
  NOT_FOUND: 'הפריט המבוקש לא נמצא',
  CONFLICT: 'הפעולה מתנגשת בנתונים קיימים',
  RATE_LIMITED: 'יותר מדי ניסיונות. נסו שוב בעוד מספר דקות',
  INTERNAL_ERROR: 'אירעה שגיאה בלתי צפויה. נסו שוב מאוחר יותר',
};
