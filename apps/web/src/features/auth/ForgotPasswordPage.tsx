import { zodResolver } from '@hookform/resolvers/zod';
import {
  authWebPaths,
  PASSWORD_RESET_TOKEN_TTL_MS,
  passwordResetRequestSchema,
  type PasswordResetRequest,
} from '@leadflow/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, AuthLayout, Button, Field, TextLink } from '../../components/ui';
import { useRequestPasswordReset } from './api';
import { applyServerErrors } from './serverErrors';

const RESET_LINK_MINUTES = Math.round(PASSWORD_RESET_TOKEN_TTL_MS / 60_000);

export function ForgotPasswordPage() {
  const requestReset = useRequestPasswordReset();
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordResetRequest>({
    resolver: zodResolver(passwordResetRequestSchema),
    mode: 'onTouched',
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await requestReset.mutateAsync(values);
      setSentTo(values.email);
    } catch (err) {
      setFormError(applyServerErrors(err, setError, ['email']));
    }
  });

  const footer = <TextLink to={authWebPaths.login}>חזרה לכניסה</TextLink>;

  if (sentTo) {
    // Same text whether or not the address is registered (no account enumeration).
    return (
      <AuthLayout title="בדקו את תיבת הדואר" footer={footer}>
        <div className="flex flex-col gap-4">
          <Alert tone="success" title="הבקשה התקבלה">
            אם הכתובת{' '}
            <span dir="ltr" className="font-medium">
              {sentTo}
            </span>{' '}
            רשומה אצלנו, שלחנו אליה קישור לאיפוס הסיסמה. הקישור בתוקף ל-{RESET_LINK_MINUTES} דקות.
          </Alert>
          <p className="text-sm text-ink-muted">
            לא קיבלתם הודעה? כדאי לבדוק גם בתיקיית הספאם, או לנסות שוב עם כתובת אחרת.
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              reset({ email: '' });
              setSentTo(null);
            }}
          >
            שליחה לכתובת אחרת
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="שכחת סיסמה?"
      description="הזינו את כתובת האימייל של החשבון ונשלח אליה קישור לבחירת סיסמה חדשה."
      footer={footer}
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Field
          label="אימייל"
          type="email"
          autoComplete="email"
          inputMode="email"
          ltr
          required
          error={errors.email?.message}
          {...register('email')}
        />
        <Button type="submit" size="lg" className="mt-2 w-full" loading={isSubmitting}>
          {isSubmitting ? 'שולחים…' : 'שליחת קישור לאיפוס'}
        </Button>
      </form>
    </AuthLayout>
  );
}
