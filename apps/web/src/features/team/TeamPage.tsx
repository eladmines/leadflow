import { zodResolver } from '@hookform/resolvers/zod';
import {
  can,
  INVITABLE_ROLES,
  inviteRequestSchema,
  roleLabels,
  type InviteRequest,
  type Member,
} from '@leadflow/shared';
import { Mail, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, Button, Card, Field, Select, Spinner } from '../../components/ui';
import { inputClasses } from '../../components/ui/Field';
import { cn } from '../../lib/cn';
import { applyServerErrors, errorMessage } from '../auth/serverErrors';
import { useMe } from '../auth/api';
import { useMembers } from '../businesses/api';
import { formatDateTime } from '../leads/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { NoPermission } from '../shell/NoPermission';
import { PageHeader } from '../shell/PageHeader';
import {
  useChangeRole,
  useInvitations,
  useInvite,
  useRemoveMember,
  useResendInvite,
  useRevokeInvite,
} from './api';

const roleOptions = INVITABLE_ROLES.map((r) => ({ value: r, label: roleLabels[r] }));

function InviteForm({ businessId }: { businessId: string }) {
  const invite = useInvite(businessId);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<InviteRequest>({
    resolver: zodResolver(inviteRequestSchema),
    defaultValues: { email: '', role: 'EMPLOYEE' },
  });
  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    setSentTo(null);
    try {
      await invite.mutateAsync(values);
      setSentTo(values.email);
      form.reset({ email: '', role: values.role });
    } catch (err) {
      setFormError(applyServerErrors(err, form.setError, ['email', 'role']));
    }
  });

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <UserPlus aria-hidden className="h-5 w-5 text-brand-600" />
        <h2 className="text-lg font-semibold text-ink">הזמנת חבר/ת צוות</h2>
      </div>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        {sentTo && (
          <Alert tone="success">
            ההזמנה נשלחה אל <bdi dir="ltr">{sentTo}</bdi>. היא תקפה ל-7 ימים.
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <Field
            label="אימייל"
            ltr
            type="email"
            error={form.formState.errors.email?.message}
            {...form.register('email')}
          />
          <Select label="תפקיד" options={roleOptions} {...form.register('role')} />
        </div>
        <p className="text-xs text-ink-muted">
          עובד/ת רואה רק את הלידים שהוקצו לו/לה. מנהל/ת צוות רואה את כל הלידים ויכול/ה לשייך אותם.
        </p>
        <Button type="submit" loading={form.formState.isSubmitting} className="self-start">
          שליחת הזמנה
        </Button>
      </form>
    </Card>
  );
}

function MemberRow({
  m,
  manage,
  businessId,
  isMe,
}: {
  m: Member;
  manage: boolean;
  businessId: string;
  isMe: boolean;
}) {
  const changeRole = useChangeRole(businessId);
  const remove = useRemoveMember(businessId);
  const [confirm, setConfirm] = useState(false);
  const editable = manage && m.role !== 'OWNER';
  const error = changeRole.error ?? remove.error;

  return (
    <li className="flex flex-col gap-2 px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span
          aria-hidden
          className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-100 font-semibold text-accent-700"
        >
          {m.fullName.trim().charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">
            {m.fullName}
            {isMe && <span className="ms-2 text-xs text-ink-muted">(את/ה)</span>}
          </p>
          <p className="truncate text-xs text-ink-muted">
            <bdi dir="ltr">{m.email}</bdi>
          </p>
        </div>
        {editable ? (
          <>
            <label htmlFor={`role-${m.userId}`} className="sr-only">
              התפקיד של {m.fullName}
            </label>
            <select
              id={`role-${m.userId}`}
              value={m.role}
              disabled={changeRole.isPending}
              onChange={(e) =>
                changeRole.mutate({
                  userId: m.userId,
                  role: e.target.value as InviteRequest['role'],
                })
              }
              className={cn(inputClasses(false), 'h-9 w-auto cursor-pointer')}
            >
              {roleOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {confirm ? (
              <span
                role="group"
                aria-label={`אישור הסרת ${m.fullName}`}
                className="flex items-center gap-2"
              >
                <Button
                  variant="danger"
                  size="sm"
                  loading={remove.isPending}
                  onClick={() => remove.mutate(m.userId)}
                >
                  הסרה
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                  ביטול
                </Button>
              </span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirm(true)}
                aria-label={`הסרת ${m.fullName} מהצוות`}
              >
                הסרה
              </Button>
            )}
          </>
        ) : (
          <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink">
            {roleLabels[m.role]}
          </span>
        )}
      </div>
      {confirm && (
        <p className="text-xs text-ink-muted">הגישה לעסק תיחסם מיד. הלידים וההיסטוריה יישמרו.</p>
      )}
      {error && <Alert tone="danger">{errorMessage(error)}</Alert>}
    </li>
  );
}

export function TeamPage() {
  const business = useCurrentBusiness();
  const meId = useMe().data?.user.id;
  const allowed = can(business.role, 'members.view');
  const manage = can(business.role, 'members.manage');
  const members = useMembers(business.id, allowed);
  const invitations = useInvitations(business.id, manage);
  const resend = useResendInvite(business.id);
  const revoke = useRevokeInvite(business.id);

  return (
    <>
      <PageHeader title="צוות" description="האנשים שיש להם גישה לעסק ותפקידם." />
      {!allowed ? (
        <NoPermission what="רשימת הצוות" />
      ) : (
        <>
          {manage && <InviteForm businessId={business.id} />}
          {members.isPending ? (
            <Spinner label="טוענים את הצוות…" />
          ) : members.isError ? (
            <Alert tone="danger" title="לא הצלחנו לטעון את הצוות">
              {errorMessage(members.error)}
            </Alert>
          ) : (
            <Card className="p-0">
              <ul aria-label="חברי הצוות" className="divide-y divide-surface-border">
                {members.data.map((m) => (
                  <MemberRow
                    key={m.userId}
                    m={m}
                    manage={manage}
                    businessId={business.id}
                    isMe={m.userId === meId}
                  />
                ))}
              </ul>
            </Card>
          )}
          {manage && invitations.data && invitations.data.length > 0 && (
            <Card className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold text-ink">הזמנות שממתינות לאישור</h2>
              {(resend.error ?? revoke.error) && (
                <Alert tone="danger">{errorMessage(resend.error ?? revoke.error)}</Alert>
              )}
              <ul
                aria-label="הזמנות ממתינות"
                className="flex flex-col divide-y divide-surface-border"
              >
                {invitations.data.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center gap-3 py-3">
                    <Mail aria-hidden className="h-4 w-4 text-ink-subtle" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">
                        <bdi dir="ltr">{inv.email}</bdi> · {roleLabels[inv.role]}
                      </p>
                      <p className="text-xs text-ink-muted">
                        בתוקף עד {formatDateTime(inv.expiresAt)}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={resend.isPending && resend.variables === inv.id}
                      onClick={() => resend.mutate(inv.id)}
                    >
                      שליחה שוב
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={revoke.isPending && revoke.variables === inv.id}
                      onClick={() => revoke.mutate(inv.id)}
                      aria-label={`ביטול ההזמנה של ${inv.email}`}
                    >
                      ביטול
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}
