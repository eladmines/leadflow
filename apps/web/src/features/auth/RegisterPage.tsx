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
import { tr } from '../../i18n';

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
      title={tr('יצירת חשבון חדש')}
      description={tr('כמה פרטים קצרים, ומתחילים לקבל לידים.')}
      footer={
        <>
          {tr('כבר יש לכם חשבון?')} <TextLink to={authWebPaths.login}>{tr('לכניסה')}</TextLink>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <Field
          label={tr('שם מלא')}
          autoComplete="name"
          required
          error={errors.fullName?.message}
          {...register('fullName')}
        />
        <Field
          label={tr('אימייל')}
          type="email"
          autoComplete="email"
          inputMode="email"
          ltr
          required
          error={errors.email?.message}
          {...register('email')}
        />
        <PasswordField
          label={tr('סיסמה')}
          autoComplete="new-password"
          required
          hint={tr('לפחות {0} תווים', PASSWORD_MIN_LENGTH)}
          error={errors.password?.message}
          {...register('password')}
        />
        <Checkbox
          error={errors.acceptTerms?.message}
          label={
            <>
              {tr('קראתי ואני מסכים/ה ל')}
              <a
                href={LEGAL_PLACEHOLDER_LINKS.terms}
                target="_blank"
                rel="noopener noreferrer"
                className={textLinkClasses}
              >
                {tr('תנאי השימוש')}
              </a>{' '}
              {tr('ול')}
              <a
                href={LEGAL_PLACEHOLDER_LINKS.privacy}
                target="_blank"
                rel="noopener noreferrer"
                className={textLinkClasses}
              >
                {tr('מדיניות הפרטיות')}
              </a>
            </>
          }
          {...register('acceptTerms')}
        />

        <Button type="submit" size="lg" className="mt-2 w-full" loading={isSubmitting}>
          {isSubmitting ? tr('יוצרים את החשבון…') : tr('יצירת חשבון')}
        </Button>
      </form>
    </AuthLayout>
  );
}
