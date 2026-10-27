import { Button } from '../../components/ui';
import { useResendVerification } from './api';
import { errorMessage } from './serverErrors';

interface ResendVerificationProps {
  email: string;
  variant?: 'primary' | 'secondary';
  className?: string;
}

/** "Send again" button with polite live feedback (success, rate limit, other errors). */
export function ResendVerification({
  email,
  variant = 'secondary',
  className,
}: ResendVerificationProps) {
  const resend = useResendVerification();

  return (
    <div className={className}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <Button
          variant={variant}
          size="sm"
          loading={resend.isPending}
          onClick={() => resend.mutate()}
          className="self-start"
        >
          {resend.isSuccess ? 'שליחה נוספת' : 'שליחה מחדש'}
        </Button>
        <p aria-live="polite" className="text-sm">
          {resend.isSuccess && (
            <span className="text-success-600">
              שלחנו קישור חדש אל{' '}
              <span dir="ltr" className="font-medium">
                {email}
              </span>
            </span>
          )}
          {resend.isError && <span className="text-danger-700">{errorMessage(resend.error)}</span>}
        </p>
      </div>
    </div>
  );
}
