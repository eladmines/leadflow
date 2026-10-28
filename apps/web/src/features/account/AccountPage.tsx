import { zodResolver } from '@hookform/resolvers/zod';
import {
  apiPaths,
  can,
  changePasswordRequestSchema,
  type NotificationPrefs,
  type NotificationPrefsResponse,
  updateProfileRequestSchema,
  type MeResponse,
  type UpdateProfileRequest,
} from '@leadflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Button, Card, Checkbox, Field, PasswordField, Spinner } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { meQueryKey, useMe } from '../auth/api';
import { applyServerErrors, errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';

const passwordForm = changePasswordRequestSchema
  .extend({ confirm: z.string().min(1, 'יש להזין שוב את הסיסמה החדשה') })
  .refine((v) => v.newPassword === v.confirm, {
    message: 'הסיסמאות אינן תואמות',
    path: ['confirm'],
  });
type PasswordForm = z.infer<typeof passwordForm>;

function ProfileCard() {
  const user = useMe().data?.user;
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<UpdateProfileRequest>({
    resolver: zodResolver(updateProfileRequestSchema),
    defaultValues: { fullName: user?.fullName ?? '' },
  });
  const save = useMutation({
    mutationFn: (body: UpdateProfileRequest) =>
      apiFetch<MeResponse>(apiPaths.auth.profile, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (data) => queryClient.setQueryData(meQueryKey, data),
  });
  const submit = form.handleSubmit(async (v) => {
    setSaved(false);
    setError(null);
    try {
      await save.mutateAsync(v);
      setSaved(true);
    } catch (err) {
      setError(applyServerErrors(err, form.setError, ['fullName']));
    }
  });

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-ink">פרטים אישיים</h2>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field
          label="שם מלא"
          autoComplete="name"
          error={form.formState.errors.fullName?.message}
          {...form.register('fullName')}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">אימייל</span>
          <p className="text-sm text-ink-muted">
            <bdi dir="ltr">{user?.email}</bdi> · לשינוי כתובת האימייל פנו לתמיכה
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm text-success-600">
            {saved ? 'השם עודכן' : ''}
          </p>
          <Button type="submit" loading={form.formState.isSubmitting}>
            שמירה
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<PasswordForm>({
    resolver: zodResolver(passwordForm),
    mode: 'onTouched',
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setDone(false);
    setError(null);
    try {
      await apiFetch(apiPaths.auth.password, {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      form.reset();
      setDone(true);
    } catch (err) {
      setError(applyServerErrors(err, form.setError, ['currentPassword', 'newPassword']));
    }
  });

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-ink">שינוי סיסמה</h2>
        <p className="text-sm text-ink-muted">
          אחרי השינוי ננתק את כל שאר המכשירים, ונשלח לך אימייל לאישור.
        </p>
      </div>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {done && <Alert tone="success">הסיסמה שונתה. שאר המכשירים נותקו.</Alert>}
        <PasswordField
          label="סיסמה נוכחית"
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          {...form.register('currentPassword')}
        />
        <PasswordField
          label="סיסמה חדשה"
          autoComplete="new-password"
          hint="לפחות 10 תווים"
          error={errors.newPassword?.message}
          {...form.register('newPassword')}
        />
        <PasswordField
          label="אימות הסיסמה החדשה"
          autoComplete="new-password"
          error={errors.confirm?.message}
          {...form.register('confirm')}
        />
        <Button type="submit" loading={isSubmitting} className="self-end">
          שינוי סיסמה
        </Button>
      </form>
    </Card>
  );
}

/** `/b/:businessId/account`: the signed-in user's own settings. */
/** Per-business email preferences. Only owners and managers get new-lead emails (D-043). */
function NotificationsCard() {
  const business = useCurrentBusiness();
  const path = apiPaths.businesses.notifications(business.id);
  const queryKey = ['businesses', business.id, 'notification-prefs'];
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey,
    queryFn: () => apiFetch<NotificationPrefsResponse>(path),
    select: (d) => d.prefs,
  });
  const save = useMutation({
    mutationFn: (body: NotificationPrefs) =>
      apiFetch<NotificationPrefsResponse>(path, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-ink">התראות במייל</h2>
        <p className="text-sm text-ink-muted">חלות רק על העסק {business.name}.</p>
      </div>
      {prefs.isPending ? (
        <Spinner size="sm" label="טוענים העדפות…" />
      ) : prefs.isError ? (
        <Alert tone="danger">{errorMessage(prefs.error)}</Alert>
      ) : (
        <Checkbox
          label="מייל על כל פנייה חדשה מהאתר"
          checked={prefs.data.newLeadEmail}
          disabled={save.isPending}
          onChange={(e) => save.mutate({ newLeadEmail: e.target.checked })}
        />
      )}
      {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
      <p role="status" className="text-sm text-success-600">
        {save.isSuccess ? 'ההעדפה נשמרה' : ''}
      </p>
    </Card>
  );
}

export function AccountPage() {
  const business = useCurrentBusiness();
  return (
    <>
      <PageHeader title="החשבון שלי" description="הפרטים, הסיסמה וההתראות שלך." />
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileCard />
        <PasswordCard />
        {can(business.role, 'leads.view.all') && <NotificationsCard />}
      </div>
    </>
  );
}
