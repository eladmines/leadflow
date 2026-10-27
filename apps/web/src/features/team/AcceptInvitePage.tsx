import { authWebPaths, businessWebPaths, INVITE_WEB_PATH, roleLabels } from '@leadflow/shared';
import { Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Alert, AuthLayout, Button, buttonClasses, FullPageSpinner } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useMe } from '../auth/api';
import { errorMessage } from '../auth/serverErrors';
import { useOneTimeToken } from '../auth/useOneTimeToken';
import { useSignOut } from '../auth/useSignOut';
import { Link } from 'react-router-dom';
import { useAcceptInvite, useInvitePreview } from './api';

const statusText = {
  expired: 'תוקף ההזמנה פג. בקשו מבעל/ת העסק לשלוח הזמנה חדשה.',
  used: 'ההזמנה כבר נוצלה. אם הצטרפתם, אפשר פשוט להתחבר.',
  revoked: 'ההזמנה בוטלה. בקשו מבעל/ת העסק לשלוח הזמנה חדשה.',
} as const;

/**
 * `/invite?token=`: shows who invited you and to what, then joins the business. Works for
 * signed-in users (same email), and sends others to sign in or register and come back.
 */
export function AcceptInvitePage() {
  const token = useOneTimeToken();
  const me = useMe();
  const preview = useInvitePreview(token);
  const accept = useAcceptInvite();
  const navigate = useNavigate();
  const back = `${INVITE_WEB_PATH}?token=${token ?? ''}`;
  const { signOut, isPending: signingOut } = useSignOut(
    `${authWebPaths.login}?next=${encodeURIComponent(back)}`,
  );

  if (!token) {
    return (
      <AuthLayout title="ההזמנה אינה תקפה">
        <Alert tone="danger">הקישור חסר או שגוי. בקשו מבעל/ת העסק לשלוח הזמנה חדשה.</Alert>
      </AuthLayout>
    );
  }
  if (preview.isPending || me.isPending) return <FullPageSpinner label="בודקים את ההזמנה…" />;
  if (preview.isError) {
    return (
      <AuthLayout title="ההזמנה אינה תקפה">
        <Alert tone="danger">
          {preview.error instanceof ApiError && preview.error.status === 404
            ? 'ההזמנה לא נמצאה. ייתכן שנשלחה הזמנה חדשה יותר — בדקו את תיבת הדואר.'
            : errorMessage(preview.error)}
        </Alert>
      </AuthLayout>
    );
  }

  const invite = preview.data;
  const user = me.data?.user;
  const next = encodeURIComponent(back);

  return (
    <AuthLayout
      title={`הוזמנת להצטרף ל${invite.businessName}`}
      description={
        <>
          {invite.invitedBy ? `${invite.invitedBy} הזמין/ה אותך` : 'הוזמנת'} לצוות בתפקיד{' '}
          <strong className="text-ink">{roleLabels[invite.role]}</strong>.
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded-2xl bg-surface-muted p-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-brand-700">
            <Users aria-hidden className="h-5 w-5" />
          </span>
          <div className="flex flex-col text-sm">
            <span className="text-ink-muted">ההזמנה נשלחה אל</span>
            <bdi dir="ltr" className="font-medium text-ink">
              {invite.email}
            </bdi>
          </div>
        </div>

        {invite.status !== 'valid' ? (
          <Alert tone="warning">{statusText[invite.status]}</Alert>
        ) : !user ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink-muted">כדי להצטרף צריך חשבון LeadFlow עם הכתובת הזו.</p>
            <Link
              to={`${authWebPaths.register}?next=${next}&email=${encodeURIComponent(invite.email)}`}
              className={buttonClasses('primary', 'lg')}
            >
              יצירת חשבון והצטרפות
            </Link>
            <Link
              to={`${authWebPaths.login}?next=${next}`}
              className={buttonClasses('secondary', 'lg')}
            >
              כבר יש לי חשבון — התחברות
            </Link>
          </div>
        ) : user.email !== invite.email ? (
          <div className="flex flex-col gap-3">
            <Alert tone="warning" title="מחובר/ת עם חשבון אחר">
              את/ה מחובר/ת כ־<bdi dir="ltr">{user.email}</bdi>, וההזמנה נשלחה אל{' '}
              <bdi dir="ltr">{invite.email}</bdi>.
            </Alert>
            <Button variant="secondary" loading={signingOut} onClick={() => void signOut()}>
              התנתקות והתחברות עם החשבון הנכון
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {accept.isError && <Alert tone="danger">{errorMessage(accept.error)}</Alert>}
            <Button
              size="lg"
              loading={accept.isPending}
              onClick={async () => {
                const { businessId } = await accept.mutateAsync(token);
                navigate(businessWebPaths.home(businessId), { replace: true });
              }}
            >
              הצטרפות לצוות
            </Button>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
