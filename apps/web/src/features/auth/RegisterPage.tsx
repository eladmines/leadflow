import { zodResolver } from '@hookform/resolvers/zod';
import {
  authWebPaths,
  PASSWORD_MIN_LENGTH,
  registerRequestSchema,
  type RegisterRequest,
} from '@leadflow/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  AuthLayout,
  Button,
  Checkbox,
  Field,
  PasswordField,
  TextLink,
  textLinkClasses,
} from '../../components/ui';
import { sanitizeNext } from '../../lib/safeNext';
import { useRegister } from './api';
import { applyServerErrors } from './serverErrors';

/**
 * TODO(legal): the terms of use and privacy policy documents don't exist yet.
 * Replace these placeholder paths with the real pages before launch.
 */
const LEGAL_PLACEHOLDER_LINKS = {
  terms: '/terms',
  privacy: '/privacy',
} as const;

export function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = sanitizeNext(params.get('next'));
  const registerUser = useRegister();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterRequest>({
    resolver: zodResolver(registerRequestSchema),
    mode: 'onTouched',
    // An invitation link pre-fills the invited address (`?email=`).
    defaultValues: {
      fullName: '',
      email: params.get('email') ?? '',
      password: '',
      acceptTerms: false,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await registerUser.mutateAsync(values);
      navigate(next, { replace: true });
    } catch (err) {
      setFormError(
        applyServerErrors(err, setError, ['fullName', 'email', 'password', 'acceptTerms']),
      );
    }
  });

  return (
    <AuthLayout
      title="יצירת חשבון חדש"
      description="כמה פרטים קצרים, ומתחילים לקבל לידים."
      footer={
        <>
          כבר יש לכם חשבון? <TextLink to={authWebPaths.login}>לכניסה</TextLink>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <Field
          label="שם מלא"
          autoComplete="name"
          required
          error={errors.fullName?.message}
          {...register('fullName')}
        />
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
        <PasswordField
          label="סיסמה"
          autoComplete="new-password"
          required
          hint={`לפחות ${PASSWORD_MIN_LENGTH} תווים`}
          error={errors.password?.message}
          {...register('password')}
        />
        <Checkbox
          error={errors.acceptTerms?.message}
          label={
            <>
              קראתי ואני מסכים/ה ל
              <a
                href={LEGAL_PLACEHOLDER_LINKS.terms}
                target="_blank"
                rel="noopener noreferrer"
                className={textLinkClasses}
              >
                תנאי השימוש
              </a>{' '}
              ול
              <a
                href={LEGAL_PLACEHOLDER_LINKS.privacy}
                target="_blank"
                rel="noopener noreferrer"
                className={textLinkClasses}
              >
                מדיניות הפרטיות
              </a>
            </>
          }
          {...register('acceptTerms')}
        />

        <Button type="submit" size="lg" className="mt-2 w-full" loading={isSubmitting}>
          {isSubmitting ? 'יוצרים את החשבון…' : 'יצירת חשבון'}
        </Button>
      </form>
    </AuthLayout>
  );
}
