import { formatIsraeliPhone } from '@leadflow/shared';
import { Alert, Button, EmptyState, Spinner } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';
import { useForgetPersonal, usePersonalNumbers } from './api';
import { tr } from '../../i18n';

/** Phone in local form when it is Israeli, otherwise as received. */
const showPhone = (e164: string) => (e164.startsWith('+972') ? formatIsraeliPhone(e164) : e164);

/** Numbers marked personal, with a way to undo the marking. */
export function PersonalNumbers({ businessId }: { businessId: string }) {
  const personal = usePersonalNumbers(businessId);
  const forget = useForgetPersonal(businessId);
  if (personal.isPending) return <Spinner label={tr('טוענים…')} />;
  if (personal.isError) return <Alert tone="danger">{errorMessage(personal.error)}</Alert>;
  if (personal.data.length === 0) {
    return (
      <EmptyState
        title={tr('אין מספרים פרטיים')}
        description={tr('מספר שתסמנו כפרטי (חברים, משפחה) יופיע כאן, וההודעות שלו לא יישמרו.')}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        {tr('הודעות מהמספרים האלה לא נשמרות. ביטול הסימון מחזיר את ההודעה הבאה מהמספר לתיבה.')}
      </p>
      {forget.isError && <Alert tone="danger">{errorMessage(forget.error)}</Alert>}
      <ul
        aria-label={tr('מספרים פרטיים')}
        className="divide-y divide-surface-border rounded-xl border border-surface-border"
      >
        {personal.data.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
            {p.channel === 'messenger' ? (
              <span className="text-sm text-ink">
                {tr('משתמש/ת פייסבוק')} · {tr('פייסבוק')}
              </span>
            ) : (
              <bdi dir="ltr" className="text-sm text-ink">
                {showPhone(p.phone)}
              </bdi>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => forget.mutate(p.id)}
              loading={forget.isPending && forget.variables === p.id}
              aria-label={tr(
                'ביטול סימון פרטי ל-{0}',
                p.channel === 'messenger' ? tr('משתמש/ת פייסבוק') : showPhone(p.phone),
              )}
            >
              {tr('ביטול סימון')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
