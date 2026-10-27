import { zodResolver } from '@hookform/resolvers/zod';
import { authWebPaths, loginRequestSchema, type LoginRequest } from '@leadflow/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, AuthLayout, Button, Field, PasswordField, TextLink } from '../../components/ui';
import { sanitizeNext } from '../../lib/safeNext';
import { useLogin } from './api';
import { applyServerErrors } from './serverErrors';

export interface LoginLocationState {
  notice?: 'passwordReset';
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const next = sanitizeNext(params.get('next'));
  const notice = (location.state as LoginLocationState | null)?.notice;
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login.mutateAsync(values);
      navigate(next, { replace: true });
    } catch (err) {
      setFormError(applyServerErrors(err, setError, ['email', 'password']));
    }
  });

  const registerHref =
    next === authWebPaths.appHome
      ? authWebPaths.register
      : `${authWebPaths.register}?next=${encodeURIComponent(next)}`;

  return (
    <AuthLayout
      title="כניסה לחשבון"
      description="ברוכים השבים! הזינו את פרטי ההתחברות שלכם."
      footer={
        <>
          עדיין אין לכם חשבון? <TextLink to={registerHref}>להרשמה בחינם</TextLink>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {notice === 'passwordReset' && !formError && (
          <Alert tone="success" title="הסיסמה עודכנה. אפשר להתחבר">
            מטעמי אבטחה, נותקת מכל המכשירים.
          </Alert>
        )}
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
        <div className="flex flex-col gap-2">
          <PasswordField
            label="סיסמה"
            autoComplete="current-password"
            required
            error={errors.password?.message}
            {...register('password')}
          />
          <TextLink to={authWebPaths.forgotPassword} className="self-start text-sm">
            שכחתי סיסמה
          </TextLink>
        </div>

        <Button type="submit" size="lg" className="mt-2 w-full" loading={isSubmitting}>
          {isSubmitting ? 'מתחברים…' : 'כניסה'}
        </Button>
      </form>
    </AuthLayout>
  );
}
