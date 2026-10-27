import { can, roleLabels } from '@leadflow/shared';
import { Alert, Card, Spinner } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';
import { useMembers } from '../businesses/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { NoPermission } from '../shell/NoPermission';
import { PageHeader } from '../shell/PageHeader';

export function TeamPage() {
  const business = useCurrentBusiness();
  const allowed = can(business.role, 'members.view');
  const members = useMembers(business.id, allowed);

  return (
    <>
      <PageHeader title="צוות" description="האנשים שיש להם גישה לעסק ותפקידם." />
      {!allowed ? (
        <NoPermission what="רשימת הצוות" />
      ) : members.isPending ? (
        <Spinner label="טוענים את הצוות…" />
      ) : members.isError ? (
        <Alert tone="danger" title="לא הצלחנו לטעון את הצוות">
          {errorMessage(members.error)}
        </Alert>
      ) : (
        <>
          <Card className="p-0">
            <ul aria-label="חברי הצוות" className="divide-y divide-surface-border">
              {members.data.map((m) => (
                <li
                  key={m.userId}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{m.fullName}</p>
                    <p className="truncate text-xs text-ink-muted">
                      <bdi dir="ltr">{m.email}</bdi>
                    </p>
                  </div>
                  <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-ink">
                    {roleLabels[m.role]}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <p className="text-sm text-ink-muted">הזמנת עובדים וניהול הרשאות יתווספו בקרוב.</p>
        </>
      )}
    </>
  );
}
