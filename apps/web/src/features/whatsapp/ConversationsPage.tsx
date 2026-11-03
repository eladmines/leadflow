import { businessWebPaths, can, formatIsraeliPhone, type InboxNumber } from '@leadflow/shared';
import { Briefcase, UserX } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, EmptyState, RefreshButton, Spinner } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';
import { formatDateTime, timeAgo } from '../leads/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { NoPermission } from '../shell/NoPermission';
import { PageHeader } from '../shell/PageHeader';
import { useClassifyNumber, useForgetPersonal, usePersonalNumbers, useWhatsAppInbox } from './api';
import { tr } from '../../i18n';

/** Phone in local form when it is Israeli, otherwise as received. */
const showPhone = (e164: string) => (e164.startsWith('+972') ? formatIsraeliPhone(e164) : e164);

/** `/b/:businessId/conversations`: WhatsApp numbers waiting to be classified (D-092). */
export function ConversationsPage() {
  const business = useCurrentBusiness();
  if (!can(business.role, 'whatsapp.inbox')) return <NoPermission what={tr('שיחות WhatsApp')} />;
  return <Inbox businessId={business.id} />;
}

function Inbox({ businessId }: { businessId: string }) {
  const inbox = useWhatsAppInbox(businessId);
  const queryClient = useQueryClient();
  const [done, setDone] = useState<{ name: string; leadId: string | null } | null>(null);

  return (
    <>
      <PageHeader
        title={tr('שיחות WhatsApp')}
        description={tr(
          'הודעות ממספרים חדשים מחכות כאן עד שתחליטו: לקוח או פרטי. ההחלטה נשמרת, וההודעות הבאות מאותו מספר יגיעו למקום הנכון לבד.',
        )}
        actions={
          <RefreshButton
            onRefresh={() =>
              queryClient.invalidateQueries({ queryKey: ['businesses', businessId, 'whatsapp'] })
            }
          />
        }
      />
      {done && (
        <Alert tone="success">
          {done.leadId ? (
            <>
              {done.name} {tr('נוסף/ה כליד.')}{' '}
              <Link
                to={`${businessWebPaths.section(businessId, 'leads')}/${done.leadId}`}
                className="font-medium underline"
              >
                {tr('פתיחת הליד')}
              </Link>
            </>
          ) : (
            tr(
              '{0} סומן/ה כפרטי. ההודעות נמחקו, והודעות הבאות מהמספר הזה לא ייכנסו למערכת.',
              done.name,
            )
          )}
        </Alert>
      )}
      {inbox.isPending ? (
        <Spinner label={tr('טוענים את השיחות…')} />
      ) : inbox.isError ? (
        <Alert tone="danger">{errorMessage(inbox.error)}</Alert>
      ) : !inbox.data.connected && inbox.data.numbers.length === 0 ? (
        <EmptyState
          title={tr('WhatsApp עדיין לא מחובר')}
          description={tr('אחרי חיבור מספר WhatsApp לעסק, הודעות ממספרים חדשים יופיעו כאן לסיווג.')}
        />
      ) : inbox.data.numbers.length === 0 ? (
        <EmptyState
          title={tr('אין הודעות שמחכות לסיווג')}
          description={tr(
            'הודעות מלקוחות מוכרים נכנסות ישר לליד שלהם. כשמספר חדש יכתוב, הוא יופיע כאן.',
          )}
        />
      ) : (
        <ul aria-label={tr('מספרים שמחכים לסיווג')} className="flex flex-col gap-4">
          {inbox.data.numbers.map((n) => (
            <li key={n.id}>
              <NumberCard businessId={businessId} number={n} onDone={setDone} />
            </li>
          ))}
        </ul>
      )}
      <PersonalNumbers businessId={businessId} />
    </>
  );
}

function NumberCard({
  businessId,
  number,
  onDone,
}: {
  businessId: string;
  number: InboxNumber;
  onDone: (d: { name: string; leadId: string | null }) => void;
}) {
  const classify = useClassifyNumber(businessId);
  const name = number.profileName || showPhone(number.phone);
  const act = (as: 'BUSINESS' | 'PERSONAL') =>
    classify.mutate(
      { numberId: number.id, as },
      { onSuccess: (res) => onDone({ name, leadId: res.leadId }) },
    );

  return (
    <Card className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <h2 className="text-base font-semibold text-ink">{name}</h2>
          <p className="text-sm text-ink-muted">
            <bdi dir="ltr">{showPhone(number.phone)}</bdi> ·{' '}
            <time dateTime={number.lastMessageAt} title={formatDateTime(number.lastMessageAt)}>
              {timeAgo(number.lastMessageAt)}
            </time>
          </p>
        </div>
        <span className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-ink-muted">
          {tr('לא מסווג')}
        </span>
      </header>
      <ol
        aria-label={tr('הודעות מ{0}', name)}
        className="flex max-h-60 flex-col gap-2 overflow-y-auto rounded-xl bg-surface-muted p-3"
      >
        {number.messages.map((m) => (
          <li key={m.id} className="flex flex-col gap-0.5">
            <p className="whitespace-pre-line break-words text-sm text-ink">{m.body}</p>
            <time dateTime={m.createdAt} className="text-xs text-ink-muted">
              {timeAgo(m.createdAt)}
            </time>
          </li>
        ))}
      </ol>
      {classify.isError && <Alert tone="danger">{errorMessage(classify.error)}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => act('BUSINESS')}
          loading={classify.isPending && classify.variables?.as === 'BUSINESS'}
          disabled={classify.isPending}
        >
          <Briefcase aria-hidden className="h-4 w-4" />
          {tr('עסקי: יצירת ליד')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => act('PERSONAL')}
          loading={classify.isPending && classify.variables?.as === 'PERSONAL'}
          disabled={classify.isPending}
        >
          <UserX aria-hidden className="h-4 w-4" />
          {tr('פרטי')}
        </Button>
        <p className="text-xs text-ink-muted">
          {tr('פרטי: ההודעות יימחקו, והמספר לא ייכנס למערכת גם בהמשך.')}
        </p>
      </div>
    </Card>
  );
}

/** Numbers marked personal, with a way to undo the marking. */
function PersonalNumbers({ businessId }: { businessId: string }) {
  const personal = usePersonalNumbers(businessId);
  const forget = useForgetPersonal(businessId);
  if (personal.isPending || personal.isError || personal.data.length === 0) return null;
  return (
    <details className="rounded-xl border border-surface-border bg-surface p-4">
      <summary className="cursor-pointer text-sm font-medium text-ink">
        {tr('מספרים פרטיים (')}
        {personal.data.length})
      </summary>
      <p className="mt-2 text-xs text-ink-muted">
        {tr('הודעות מהמספרים האלה לא נשמרות. ביטול הסימון מחזיר את ההודעה הבאה מהמספר לתיבה.')}
      </p>
      {forget.isError && (
        <div className="mt-2">
          <Alert tone="danger">{errorMessage(forget.error)}</Alert>
        </div>
      )}
      <ul aria-label={tr('מספרים פרטיים')} className="mt-3 divide-y divide-surface-border">
        {personal.data.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2">
            <bdi dir="ltr" className="text-sm text-ink">
              {showPhone(p.phone)}
            </bdi>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => forget.mutate(p.id)}
              loading={forget.isPending && forget.variables === p.id}
              aria-label={tr('ביטול סימון פרטי ל-{0}', showPhone(p.phone))}
            >
              {tr('ביטול סימון')}
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
