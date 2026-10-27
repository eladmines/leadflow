import { zodResolver } from '@hookform/resolvers/zod';
import { authWebPaths, PASSWORD_MIN_LENGTH, passwordResetConfirmSchema } from '@leadflow/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import {
  Alert,
  AuthLayout,
  Button,
  buttonClasses,
  PasswordField,
  TextLink,
} from '../../components/ui';
import { ApiError } from '../../lib/api';
import { resetSessionCache, useConfirmPasswordReset } from './api';
import { InvalidLinkState } from './InvalidLinkState';
import type { LoginLocationState } from './LoginPage';
import { applyServerErrors } from './serverErrors';
import { useOneTimeToken } from './useOneTimeToken';

export const resetFormMessages = {
  confirmRequired: 'יש להזין שוב את הסיסמה',
  confirmMismatch: 'הסיסמאות אינן תואמות',
} as const;

interface ResetPasswordForm {
  newPassword: string;
  /** Client-only check; never sent to the API. */
  confirmPassword: string;
}

/**
 * The shared `newPassword` rule plus a client-only confirmation field. `passthrough` keeps
 * `confirmPassword` for the refinement (zod is reached only through the shared schemas).
 */
const resetPasswordFormSchema = passwordResetConfirmSchema
  .pick({ newPassword: true })
  .passthrough()
  .superRefine((data, ctx) => {
    const confirm = (data as Partial<ResetPasswordForm>).confirmPassword;
    if (!confirm) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: resetFormMessages.confirmRequired,
      });
    } else if (confirm !== data.newPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: resetFormMessages.confirmMismatch,
      });
    }
  });

function isInvalidTokenError(err: unknown) {
  return err instanceof ApiError && err.status === 400 && Boolean(err.fields?.token);
}

export function ResetPasswordPage() {
  const token = useOneTimeToken();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirmReset = useConfirmPasswordReset();
  const [formError, setFormError] = useState<string | null>(null);
  const [tokenRejected, setTokenRejected] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordFormSchema),
    mode: 'onTouched',
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ newPassword }) => {
    if (!token) return;
    setFormError(null);
    try {
      await confirmReset.mutateAsync({ token, newPassword });
      // The server revoked every session, including this browser's.
      resetSessionCache(queryClient);
      const state: LoginLocationState = { notice: 'passwordReset' };
      navigate(authWebPaths.login, { replace: true, state });
    } catch (err) {
      if (isInvalidTokenError(err)) {
        setTokenRejected(true);
        return;
      }
      setFormError(applyServerErrors(err, setError, ['newPassword']));
    }
  });

  if (!token || tokenRejected) {
    return (
      <InvalidLinkState>
        <Link to={authWebPaths.forgotPassword} className={buttonClasses('primary', 'lg', 'w-full')}>
          בקשת קישור חדש לאיפוס
        </Link>
        <p className="text-center text-sm text-ink-muted">
          נזכרתם בסיסמה? <TextLink to={authWebPaths.login}>לכניסה</TextLink>
        </p>
      </InvalidLinkState>
    );
  }

  return (
    <AuthLayout
      title="בחירת סיסמה חדשה"
      description="אחרי השמירה ננתק את החשבון מכל המכשירים, ותוכלו להתחבר עם הסיסמה החדשה."
      footer={<TextLink to={authWebPaths.login}>חזרה לכניסה</TextLink>}
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <PasswordField
          label="סיסמה חדשה"
          autoComplete="new-password"
          required
          hint={`לפחות ${PASSWORD_MIN_LENGTH} תווים`}
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />
        <PasswordField
          label="אימות הסיסמה החדשה"
          autoComplete="new-password"
          required
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button type="submit" size="lg" className="mt-2 w-full" loading={isSubmitting}>
          {isSubmitting ? 'שומרים…' : 'שמירת הסיסמה'}
        </Button>
      </form>
    </AuthLayout>
  );
}
