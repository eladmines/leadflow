import {
  addNoteRequestSchema,
  businessWebPaths,
  can,
  formatIsraeliPhone,
  leadSourceLabels,
  leadValueForStageKind,
  type LeadDetailResponse,
  type RelatedLead,
  type Activity,
  type AddNoteRequest,
  type Lead,
  type WhatsAppMessage,
  appointmentStatusLabels,
  formatAgorot,
} from '@simplecatch/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  FileText,
  History as HistoryIcon,
  Info,
  ListTodo,
  Mail,
  MessageCircle,
  MessageSquareText,
  Phone,
  StickyNote,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  buttonClasses,
  DialogShell,
  EmptyState,
  MoreMenu,
  SelectMenu,
  Spinner,
  Textarea,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import { ApiError } from '../../lib/api';
import { errorMessage } from '../auth/serverErrors';
import { useMembers } from '../businesses/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import {
  formatDateTime,
  shekel,
  timeAgo,
  useAddNote,
  useDeleteLead,
  useLeadDetail,
  usePipeline,
  useUpdateLead,
} from './api';
import { AttributionDetails, attributionRows, attributionSourceName } from './Attribution';
import { stageColor } from './stageColors';
import { WHATSAPP_REPLY_ID } from '../whatsapp/WhatsAppThread';
import { useWhatsAppThread } from '../whatsapp/api';
import { LeadSourceIcon } from './SourceIcon';
import {
  awaitingReply,
  defaultChannel,
  LeadCommunication,
  parseChannel,
  useCommChannels,
  type CommChannel,
} from './LeadCommunication';
import { isQuoteNeeded, QuoteNeededDialog } from './QuoteNeededDialog';
import {
  CustomFieldChanges,
  CustomFieldsPanel,
  useCustomFieldsDraft,
  type CustomFieldsDraft,
} from './CustomFieldsCard';
import {
  LeadAppointments,
  LeadQuotes,
  LeadTasks,
  valueSummary,
  useLeadAppointments,
  useLeadOpenTasks,
  useLeadQuotes,
} from './LeadCards';
import { NewAppointmentDialog } from '../appointments/NewAppointmentDialog';
import { useUnsavedChangesGuard } from '../../lib/useUnsavedChangesGuard';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { isRtl, tr, intlLocale } from '../../i18n';

/** Old history entries keep their labels (the fields were removed by D-207, D-209 and D-222). */
const fieldLabels: Record<string, string> = {
  expectedValue: tr('ערך משוער'),
  nextActionAt: tr('תאריך טיפול הבא'),
  message: tr('פרטי הפנייה'),
  tags: tr('תגיות'),
  customFields: tr('שדות נוספים'),
};

const apptWhenFmt = new Intl.DateTimeFormat(intlLocale(), {
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const apptWhen = (iso: unknown) =>
  typeof iso === 'string' ? apptWhenFmt.format(new Date(iso)) : '';

function activityText(a: Activity): string {
  const d = a.data as Record<string, unknown>;
  switch (a.type) {
    case 'lead.created':
      return d.source === 'manual'
        ? tr('הליד נוצר ידנית')
        : d.source === 'whatsapp'
          ? tr('הליד נוצר מהודעת וואטסאפ')
          : d.source === 'facebook'
            ? tr('הליד נוצר מהודעה בפייסבוק')
            : d.source === 'instagram'
              ? tr('הליד נוצר מהודעה באינסטגרם')
              : tr('הליד נוצר מטופס באתר');
    case 'lead.stage_changed':
      return tr('השלב שונה מ"{0}" ל"{1}"', String(d.from), String(d.to));
    case 'lead.assigned':
      return d.to ? tr('הליד שויך ל{0}', String(d.to)) : tr('השיוך הוסר');
    case 'lead.updated':
      return tr(
        'עודכנו: {0}',
        ((d.fields as string[]) ?? []).map((f) => fieldLabels[f] ?? f).join(', '),
      );
    case 'lead.note':
      return String(d.text ?? '');
    case 'task.created':
      return tr(
        'נוספה משימה: {0}{1}',
        String(d.title),
        d.assignee ? ` (${String(d.assignee)})` : '',
      );
    case 'task.completed':
      return tr('בוצעה משימה: {0}', String(d.title));
    case 'quote.created':
      return tr('נוצרה הצעת מחיר מס׳ {0} ({1})', String(d.number), formatAgorot(Number(d.total)));
    case 'quote.sent':
      return tr('הצעת מחיר מס׳ {0} נשלחה ללקוח', String(d.number));
    case 'quote.accepted':
      return tr('הצעת מחיר מס׳ {0} אושרה{1}', String(d.number), a.actor ? '' : tr(' על ידי הלקוח'));
    case 'quote.rejected':
      return tr('הצעת מחיר מס׳ {0} נדחתה{1}', String(d.number), a.actor ? '' : tr(' על ידי הלקוח'));
    case 'appointment.created':
      return `${
        d.source === 'whatsapp'
          ? d.requested
            ? tr('הלקוח ביקש בוואטסאפ פגישה ל')
            : tr('הלקוח קבע בוואטסאפ פגישה ל')
          : d.requested
            ? tr('התקבלה מהאתר בקשה לפגישה ל')
            : tr('נקבעה פגישה ל')
      }${apptWhen(d.startsAt)}${d.service ? ` (${String(d.service)})` : ''}`;
    case 'appointment.updated':
      return tr(
        'הפגישה עודכנה: {0} · {1}',
        apptWhen(d.startsAt),
        tr(appointmentStatusLabels[d.status as keyof typeof appointmentStatusLabels]) ?? '',
      );
  }
}

/** The stage, a coloured badge with its menu; saves at once (a move that needs a quote offers to write one). */
function StageField({ lead }: { lead: Lead }) {
  const business = useCurrentBusiness();
  const stages = usePipeline(business.id);
  const update = useUpdateLead(business.id);
  const [needsQuote, setNeedsQuote] = useState(false);
  const tone = stageColor(lead.stage, stages.data).tag;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      {/* D-217: a coloured badge with its menu (the name is written too, never colour only). */}
      <Property label={tr('שלב')} labelForControl>
        <SelectMenu
          id="lead-stage"
          label={tr('שלב')}
          labelHidden
          className="items-start"
          searchable={false}
          buttonClassName={cn(
            'rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2',
            tone,
          )}
          value={lead.stage.id}
          onChange={(v) =>
            update.mutate(
              { leadId: lead.id, body: { stageId: v } },
              { onError: (err) => isQuoteNeeded(err) && setNeedsQuote(true) },
            )
          }
          options={(stages.data ?? []).map((st) => ({ value: st.id, label: tr(st.name) }))}
        />
      </Property>
      {update.isError && !isQuoteNeeded(update.error) && (
        <Alert tone="danger">{errorMessage(update.error)}</Alert>
      )}
      <QuoteNeededDialog
        businessId={business.id}
        lead={needsQuote ? lead : null}
        onClose={() => setNeedsQuote(false)}
      />
    </div>
  );
}

/** The owner: a menu for those who assign, plain text for others; saves at once. */
function OwnerField({ lead }: { lead: Lead }) {
  const business = useCurrentBusiness();
  const canAssign = can(business.role, 'leads.assign');
  const members = useMembers(business.id, canAssign);
  const update = useUpdateLead(business.id);
  return (
    <div className="flex flex-col gap-1.5">
      {canAssign ? (
        <Property label={tr('אחראי')} labelForControl>
          <SelectMenu
            id="lead-owner"
            label={tr('אחראי')}
            labelHidden
            // As wide as a name, not the whole column (owner, 2026-11-28).
            className="w-56"
            value={lead.owner?.id ?? ''}
            onChange={(v) => update.mutate({ leadId: lead.id, body: { ownerId: v || null } })}
            options={[
              { value: '', label: tr('ללא אחראי') },
              ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.fullName })),
            ]}
          />
        </Property>
      ) : (
        <Property label={tr('אחראי')} labelId="lead-owner-label">
          <p id="lead-owner" aria-labelledby="lead-owner-label">
            {lead.owner?.name ?? tr('ללא אחראי')}
          </p>
        </Property>
      )}
      <SaveState update={update} />
    </div>
  );
}

function SaveState({ update }: { update: ReturnType<typeof useUpdateLead> }) {
  if (update.isError) return <Alert tone="danger">{errorMessage(update.error)}</Alert>;
  if (!update.isPending) return null;
  return (
    <p role="status" className="text-xs text-ink-muted">
      {tr('שומר…')}
    </p>
  );
}

/** The "הערות" tab (D-211): the team's notes only; system events are in the history. */
function Notes({
  leadId,
  activities,
  focus = 0,
}: {
  leadId: string;
  activities: Activity[];
  /** Bumped by the "+" menu's "הערה": the cursor goes to the note box. */
  focus?: number;
}) {
  const business = useCurrentBusiness();
  const addNote = useAddNote(business.id, leadId);
  const form = useForm<AddNoteRequest>({
    resolver: zodResolver(addNoteRequestSchema),
    defaultValues: { text: '' },
  });
  const submit = form.handleSubmit(async (v) => {
    await addNote.mutateAsync(v);
    form.reset();
  });
  const notes = activities.filter((a) => a.type === 'lead.note');
  const { setFocus } = form;
  useEffect(() => {
    if (focus > 0) setFocus('text');
  }, [focus, setFocus]);

  return (
    <div className="flex flex-col gap-4 p-3">
      <form noValidate onSubmit={submit} className="flex flex-col gap-2">
        <Textarea
          label={tr('הוספת הערה')}
          rows={3}
          placeholder={tr('למשל: דיברנו בטלפון, מחכה להצעת מחיר')}
          error={form.formState.errors.text?.message}
          {...form.register('text')}
        />
        {addNote.isError && <Alert tone="danger">{errorMessage(addNote.error)}</Alert>}
        <Button type="submit" size="sm" loading={addNote.isPending} className="self-end">
          {tr('שמירת הערה')}
        </Button>
      </form>
      {notes.length > 0 ? (
        <ol aria-label={tr('הערות')} className="flex flex-col gap-3">
          {notes.map((a) => (
            <li key={a.id} className="flex flex-col gap-0.5">
              <p className="flex items-start gap-1.5 whitespace-pre-line rounded-xl bg-surface-muted p-3 text-sm text-ink [overflow-wrap:anywhere]">
                <MessageSquareText aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
                {activityText(a)}
              </p>
              <ActivityMeta activity={a} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-ink-muted">{tr('עדיין אין הערות.')}</p>
      )}
    </div>
  );
}

function ActivityMeta({ activity: a }: { activity: Activity }) {
  return (
    <p className="text-xs text-ink-muted">
      {a.actor?.name ? `${a.actor.name} · ` : ''}
      <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>
        {timeAgo(a.createdAt)}
      </time>
    </p>
  );
}

/** What happened on the lead: system events only; notes are in the notes tab (D-218). */
const systemEvents = (activities: Activity[]) => activities.filter((a) => a.type !== 'lead.note');

function History({ activities }: { activities: Activity[] }) {
  const events = systemEvents(activities);
  return (
    // Its own tab (owner, 2026-11-28): system events, newest first as stored.
    <section aria-label={tr('היסטוריה')} className="p-4">
      {events.length === 0 && <p className="text-sm text-ink-muted">{tr('אין עדיין אירועים.')}</p>}
      <ol aria-label={tr('היסטוריית הליד')} className="flex flex-col">
        {events.map((a) => (
          <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
            <span
              aria-hidden
              className={cn(
                'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
                a.type === 'lead.note' ? 'bg-accent-500' : 'bg-brand-300',
              )}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="whitespace-pre-line text-sm text-ink [overflow-wrap:anywhere]">
                {activityText(a)}
              </p>
              {a.type === 'lead.updated' && <CustomFieldChanges activity={a} />}
              <ActivityMeta activity={a} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Sources whose first message already shows in the lead's conversation. */
const CONVERSATION_SOURCES: readonly string[] = ['whatsapp', 'facebook', 'instagram', 'email'];

const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '')}`;

/**
 * The WhatsApp button (the phone bar). When the business's WhatsApp is connected and this lead's
 * conversation runs on it, the button opens "תקשורת" → WhatsApp here (D-221) and puts the cursor in
 * the reply box; otherwise (not connected, another channel, or no access to the conversation) it
 * opens wa.me in a new tab. The accessible name says which.
 */
function WhatsAppAction({
  phone,
  inApp,
  onOpen,
  className,
  iconOnly = false,
}: {
  phone: string | null;
  inApp: boolean;
  onOpen: () => void;
  className: string;
  /** A round icon button; the name and tooltip still say what it does. */
  iconOnly?: boolean;
}) {
  const content = (
    <>
      <MessageCircle aria-hidden className={iconOnly ? 'h-5 w-5' : 'h-4 w-4 shrink-0'} />
      {!iconOnly && 'WhatsApp'}
    </>
  );
  if (inApp) {
    const name = tr('WhatsApp: מעבר לשיחה בעמוד');
    return (
      <button
        type="button"
        aria-label={name}
        title={iconOnly ? name : undefined}
        onClick={onOpen}
        className={className}
      >
        {content}
      </button>
    );
  }
  if (!phone) return null;
  return (
    <a
      href={waLink(phone)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={tr('WhatsApp: פתיחה בחלון חדש')}
      title={iconOnly ? tr('WhatsApp: פתיחה בחלון חדש') : undefined}
      className={className}
    >
      {content}
    </a>
  );
}

/**
 * `/b/:businessId/leads/:leadId` (D-220): the lead's name, then one row of tabs — "מידע" (the
 * lead's facts, custom fields, related leads and history) first, then "תקשורת" (D-221), notes,
 * tasks, quotes and appointments.
 */
export function LeadDetailPage() {
  const business = useCurrentBusiness();
  const { leadId = '' } = useParams();
  const detail = useLeadDetail(business.id, leadId);
  const back = businessWebPaths.section(business.id, 'leads');

  if (detail.isPending) return <Spinner label={tr('טוענים את הליד…')} />;
  if (detail.isError) {
    if (detail.error instanceof ApiError && detail.error.status === 404) {
      return (
        <EmptyState
          title={tr('הליד לא נמצא')}
          description={tr('ייתכן שהקישור שגוי, או שהליד לא משויך אליך.')}
          action={
            <Link to={back} className={buttonClasses('secondary', 'md')}>
              {tr('חזרה לכל הלידים')}
            </Link>
          }
        />
      );
    }
    return <Alert tone="danger">{errorMessage(detail.error)}</Alert>;
  }
  return (
    <LeadPage
      // Another lead (e.g. a related one) starts fresh: no drafts carried over.
      key={detail.data.lead.id}
      lead={detail.data.lead}
      activities={detail.data.activities}
      related={relatedLeadsOf(detail.data)}
    />
  );
}

/** Old `?tab=` values (D-211/D-212/D-219) whose content is now in "מידע". */
// Old links: the customer tab and related leads are part of "מידע" now (owner, 2026-11-28).
const INFO_ALIASES: readonly string[] = ['more', 'related', 'customer'];

function LeadPage({
  lead,
  activities,
  related,
}: {
  lead: Lead;
  activities: Activity[];
  related: RelatedLead[];
}) {
  const business = useCurrentBusiness();
  // Phones and tablets keep the bottom bar (D-211); the page is one column everywhere (D-220).
  const desktop = useMediaQuery('(min-width: 1024px)');
  const back = businessWebPaths.section(business.id, 'leads');
  const draft = useCustomFieldsDraft(lead);
  const guard = useUnsavedChangesGuard(draft.dirty);
  const quotes = useLeadQuotes(lead);
  const appts = useLeadAppointments(lead);
  const tasks = useLeadOpenTasks(lead);
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);

  const phone = lead.contact.phone;
  // The conversation the page already loads (the WhatsApp tab's query, shared from the cache).
  const thread = useWhatsAppThread(business.id, lead.id);
  const whatsappInApp = Boolean(
    thread.data?.connected && (thread.data.channel ?? 'whatsapp') === 'whatsapp',
  );
  const messages = thread.data?.messages ?? [];
  const notes = activities.filter((a) => a.type === 'lead.note');

  // D-220: every tab is always shown; "מידע" unless the address asks for another. The old
  // conversation tab (`?tab=whatsapp`) is "תקשורת" on WhatsApp (D-221).
  const tab: LeadTab =
    asked === 'whatsapp'
      ? 'communication'
      : asked && (LEAD_TABS as readonly string[]).includes(asked)
        ? (asked as LeadTab)
        : 'info';

  // "תקשורת"'s channel (D-221): the address's, else the latest message's, the source's or WhatsApp.
  const commChannels = useCommChannels(messages);
  const askedChannel = parseChannel(asked === 'whatsapp' ? 'whatsapp' : params.get('channel'));
  const channel: CommChannel =
    askedChannel && commChannels.includes(askedChannel)
      ? askedChannel
      : defaultChannel(lead, messages, commChannels);

  const selectTab = (t: LeadTab, ch?: CommChannel) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set('tab', t);
        if (t === 'communication' && ch) next.set('channel', ch);
        else if (t !== 'communication') next.delete('channel');
        return next;
      },
      { replace: true },
    );

  // Old links open their new place, and the address says so: `?tab=more|history|related` →
  // "מידע"; `?tab=whatsapp` → "תקשורת" on WhatsApp.
  useEffect(() => {
    if (INFO_ALIASES.includes(asked ?? '')) selectTab('info');
    else if (asked === 'whatsapp') selectTab('communication', 'whatsapp');
    // Only for the address the page opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [focusReply, setFocusReply] = useState(false);
  const openConversation = () => {
    selectTab('communication', 'whatsapp');
    setFocusReply(true);
  };
  // Once the conversation tab shows: the reply box, or the conversation when the reply window is
  // closed.
  useEffect(() => {
    if (!focusReply || thread.isPending) return;
    const el =
      document.getElementById(WHATSAPP_REPLY_ID) ??
      document.getElementById('lead-comm-panel-whatsapp');
    if (!el) return;
    el.scrollIntoView?.({ block: 'center' });
    el.focus({ preventScroll: true });
    setFocusReply(false);
  }, [focusReply, tab, channel, thread.isPending]);

  const addTask = () => {
    selectTab('tasks');
    setTaskFormOpen(true);
  };

  const unsavedDialog = (
    <DialogShell
      open={guard.blocked}
      onOpenChange={(o) => !o && guard.stay()}
      title={tr('לצאת בלי לשמור?')}
    >
      <p className="text-sm text-ink-muted">
        {tr('יש בפרטים של הליד שינויים שלא נשמרו. אם יוצאים עכשיו, הם לא יישמרו.')}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={guard.stay}>
          {tr('להישאר בעמוד')}
        </Button>
        <Button variant="danger" onClick={guard.proceed}>
          {tr('לצאת בלי לשמור')}
        </Button>
      </div>
    </DialogShell>
  );

  return (
    // One centred column (D-220); on phones, room for the bottom bar.
    <div className={cn('flex w-full flex-col gap-4', !desktop && 'pb-24')}>
      <Link
        to={back}
        className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowRight aria-hidden className="h-4 w-4 ltr:rotate-180" />
        {tr('כל הלידים')}
      </Link>
      <div className="flex items-start justify-between gap-3">
        <h1 className="min-w-0 text-2xl font-semibold text-ink [overflow-wrap:anywhere]" dir="auto">
          {lead.contact.name}
        </h1>
        {/* Rare actions behind "⋯" beside the name (owner, 2026-11-28); none → no button. */}
        {can(business.role, 'leads.delete') && <DeleteLead lead={lead} leave={guard.leave} />}
      </div>
      <div className="min-w-0 rounded-2xl border border-surface-border bg-surface shadow-card">
        <LeadTabArea
          lead={lead}
          tab={tab}
          onSelect={selectTab}
          messages={messages}
          notes={notes}
          historyCount={systemEvents(activities).length}
          tasks={tasks}
          quotes={quotes}
          appts={appts}
        >
          {tab === 'info' && (
            <LeadInfo lead={lead} draft={draft} related={related} whatsappInApp={whatsappInApp} />
          )}
          {tab === 'communication' && (
            <LeadCommunication
              lead={lead}
              messages={messages}
              shown={commChannels}
              channel={channel}
              onSelect={(ch) => selectTab('communication', ch)}
            />
          )}
          {tab === 'notes' && <Notes leadId={lead.id} activities={activities} />}
          {tab === 'history' && <History activities={activities} />}
          {tab === 'tasks' && (
            <div className="flex flex-col gap-3 p-3">
              <LeadTasks
                lead={lead}
                tasks={tasks}
                formOpen={taskFormOpen}
                onFormOpenChange={setTaskFormOpen}
              />
            </div>
          )}
          {tab === 'quotes' && (
            <div className="flex flex-col gap-3 p-3">
              {(lead.value?.open ?? 0) + (lead.value?.won ?? 0) > 0 && (
                <p className="mb-3 text-sm text-ink-muted">{valueSummary(lead)}</p>
              )}
              <LeadQuotes lead={lead} quotes={quotes} />
            </div>
          )}
          {tab === 'appointments' && (
            <div className="flex flex-col gap-3 p-3">
              <LeadAppointments appts={appts} onBook={() => setBookOpen(true)} />
            </div>
          )}
        </LeadTabArea>
      </div>
      {!desktop && (
        <QuickBar
          phone={phone}
          whatsappInApp={whatsappInApp}
          onOpenConversation={openConversation}
          onAddTask={addTask}
        />
      )}
      <NewAppointmentDialog open={bookOpen} onOpenChange={setBookOpen} lead={lead} />
      {unsavedDialog}
    </div>
  );
}

const smallButton = (primary = false) =>
  cn(
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400',
    primary
      ? 'bg-brand-600 text-white hover:bg-brand-700'
      : 'text-ink-muted ring-1 ring-inset ring-surface-border hover:bg-surface-muted hover:text-ink',
  );

/** Copies a text; the tick and "הועתק" (announced) show for two seconds. */
function CopyButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={tr('העתקת {0}', label)}
        title={tr('העתקה')}
        className={smallButton()}
      >
        {copied ? (
          <Check aria-hidden className="h-4 w-4 text-success-600" />
        ) : (
          <Copy aria-hidden className="h-4 w-4" />
        )}
      </button>
      <span role="status" className="text-xs text-success-600">
        {copied ? tr('הועתק') : ''}
      </span>
    </>
  );
}

/** A phone number or an email: the value (left-to-right), copy, and its call or mail action. */
function ContactValue({
  value,
  label,
  href,
  actionLabel,
  icon,
  primary = false,
}: {
  value: string;
  label: string;
  href: string;
  actionLabel: string;
  icon: ReactNode;
  primary?: boolean;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <bdi dir="ltr" className="min-w-0 truncate" title={value}>
        {value}
      </bdi>
      <span className="flex shrink-0 items-center gap-1.5">
        <CopyButton label={label} text={value} />
        <a
          href={href}
          aria-label={actionLabel}
          title={actionLabel}
          className={smallButton(primary)}
        >
          {icon}
        </a>
      </span>
    </span>
  );
}

/**
 * The "מידע" tab (D-220), sections separated by lines: the lead's facts in two columns, then
 * "פרטים" (custom fields; none defined → no section), related leads and the history. The
 * conversations and "ממתין לתשובה שלך" are in "תקשורת" (D-221).
 */
function LeadInfo({
  lead,
  draft,
  related,
  whatsappInApp,
}: {
  lead: Lead;
  draft: CustomFieldsDraft;
  related: RelatedLead[];
  whatsappInApp: boolean;
}) {
  // The deal, its custom fields, then the person behind it (owner, 2026-11-28: one tab).
  return (
    <div className="flex flex-col divide-y divide-surface-border px-2 sm:px-3 [&>*]:py-5 [&>*:first-child]:pt-2">
      {/* The lead's facts and its custom fields are one section, "הליד". */}
      <div className="flex flex-col gap-4">
        <BasicInfo lead={lead} />
        <CustomFieldsPanel draft={draft} />
      </div>
      <LeadCustomer lead={lead} related={related} whatsappInApp={whatsappInApp} />
    </div>
  );
}

/**
 * The person behind the lead (owner, 2026-11-28): one contact can have several leads. Contact
 * details, whether they bought before, and all their leads. The totals come from the related
 * leads this member may see (D-215), so an employee's view counts only their own.
 */
function LeadCustomer({
  lead,
  related,
  whatsappInApp,
}: {
  lead: Lead;
  related: RelatedLead[];
  whatsappInApp: boolean;
}) {
  const business = useCurrentBusiness();
  const phone = lead.contact.phone;
  const email = lead.contact.email;
  const all = [{ value: lead.value, stage: lead.stage, createdAt: lead.createdAt }, ...related];
  const purchases = all.reduce((sum, l) => sum + (l.value?.won ?? 0), 0);
  const bought = all.some((l) => (l.value?.won ?? 0) > 0 || l.stage.kind === 'WON');
  const since = all.reduce((min, l) => (l.createdAt < min ? l.createdAt : min), lead.createdAt);
  return (
    <>
      <section aria-labelledby="lead-customer-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="lead-customer-title" className="text-base font-semibold text-ink">
            {tr('הלקוח')}
          </h2>
          {bought && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
              {tr('לקוח')}
            </span>
          )}
        </div>
        <div className="grid max-w-4xl grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-2">
          {phone && (
            <Property label={tr('טלפון')}>
              <ContactValue
                value={formatIsraeliPhone(phone)}
                label={tr('טלפון')}
                href={`tel:${phone}`}
                actionLabel={tr('התקשרות ל־{0}', formatIsraeliPhone(phone))}
                icon={<Phone aria-hidden className="h-4 w-4" />}
                primary={!whatsappInApp}
              />
            </Property>
          )}
          {email && (
            <Property label={tr('אימייל')}>
              <ContactValue
                value={email}
                label={tr('אימייל')}
                href={`mailto:${email}`}
                actionLabel={tr('מייל ל־{0}', email)}
                icon={<Mail aria-hidden className="h-4 w-4" />}
              />
            </Property>
          )}
          <Property label={tr('פניות')}>{all.length}</Property>
          {purchases > 0 && (
            <Property label={tr('סה״כ רכישות')}>{shekel.format(purchases)}</Property>
          )}
          <Property label={tr('איתנו מאז')}>
            <time dateTime={since}>{relatedDateFmt.format(new Date(since))}</time>
          </Property>
        </div>
      </section>
      {related.length > 0 && (
        <section aria-labelledby="lead-related-title" className="flex flex-col gap-2">
          <h2 id="lead-related-title" className="text-base font-semibold text-ink">
            {tr('פניות נוספות')} ({related.length})
          </h2>
          <RelatedLeads businessId={business.id} related={related} />
        </section>
      )}
    </>
  );
}

/**
 * The lead's facts (D-220), each once (D-218): stage and owner (editable), source (+ details),
 * phone and email, value from quotes, created, and what they asked (unless the conversation
 * already shows it).
 */
function BasicInfo({ lead }: { lead: Lead }) {
  const message = lead.message && !CONVERSATION_SOURCES.includes(lead.source) ? lead.message : null;
  return (
    <section aria-labelledby="lead-basic-title">
      <h2 id="lead-basic-title" className="mb-4 text-base font-semibold text-ink">
        {tr('הליד')}
      </h2>
      <div className="grid max-w-4xl grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-2">
        <StageField lead={lead} />
        <OwnerField lead={lead} />
        <SourceProperty lead={lead} />
        {message && (
          <div className="sm:col-span-2">
            <Property label={tr('מה ביקשו')}>
              <p className="whitespace-pre-line [overflow-wrap:anywhere]" dir="auto">
                {message}
              </p>
            </Property>
          </div>
        )}
      </div>
    </section>
  );
}

// Work order (owner, 2026-11-28): talk, follow up, quote, book; internal notes last.
const LEAD_TABS = [
  'info',
  'communication',
  'tasks',
  'quotes',
  'appointments',
  'notes',
  'history',
] as const;
/** An icon per tab (owner, 2026-11-28); the same ones as the sidebar where they exist. */
const TAB_ICONS: Record<(typeof LEAD_TABS)[number], LucideIcon> = {
  info: Info,
  communication: MessageCircle,
  tasks: ListTodo,
  quotes: FileText,
  appointments: CalendarDays,
  notes: StickyNote,
  history: HistoryIcon,
};
/** The sidebar's section colours (D-137) where a tab matches a section; only the icon is coloured. */
const TAB_ICON_COLORS: Record<(typeof LEAD_TABS)[number], string> = {
  info: 'text-violet-500',
  communication: 'text-emerald-500',
  tasks: 'text-amber-500',
  quotes: 'text-orange-500',
  appointments: 'text-rose-500',
  notes: 'text-sky-500',
  history: 'text-slate-500',
};
type LeadTab = (typeof LEAD_TABS)[number];

/**
 * D-219/D-220: one row of tabs — "מידע", then "תקשורת" (D-221), notes, tasks, quotes and
 * appointments, each always shown with its count (read out too: "משימות, 3 פתוחות"); "+" adds an
 * item. The tab is in the address (`?tab=`). Arrow keys move between tabs (in the reading
 * direction), Home/End jump to the ends.
 */
function LeadTabArea({
  lead,
  tab,
  onSelect,
  messages,
  notes,
  historyCount,
  tasks,
  quotes,
  appts,
  children,
}: {
  lead: Lead;
  tab: LeadTab;
  onSelect: (tab: LeadTab) => void;
  messages: WhatsAppMessage[];
  notes: Activity[];
  historyCount: number;
  tasks: ReturnType<typeof useLeadOpenTasks>;
  quotes: ReturnType<typeof useLeadQuotes>;
  appts: ReturnType<typeof useLeadAppointments>;
  children: ReactNode;
}) {
  const unread = awaitingReply(messages);
  const openValue = lead.value?.open ?? 0;
  // A count shows only when there is something (no "0" badges); waiting messages get the coloured badge.
  const nonZero = (n: number) => (n > 0 ? String(n) : undefined);
  const labels: Record<LeadTab, { text: string; count?: string; spoken: string; alert?: boolean }> =
    {
      info: { text: tr('מידע'), spoken: tr('מידע') },
      // Customer messages waiting for a reply (D-221).
      communication: {
        text: tr('תקשורת'),
        count: nonZero(unread),
        alert: unread > 0,
        spoken: unread > 0 ? tr('{0}, {1} הודעות חדשות', tr('תקשורת'), unread) : tr('תקשורת'),
      },
      notes: {
        text: tr('הערות'),
        count: nonZero(notes.length),
        spoken: tr('הערות, {0}', notes.length),
      },
      history: {
        text: tr('היסטוריה'),
        count: nonZero(historyCount),
        spoken: tr('היסטוריה, {0}', historyCount),
      },
      tasks: {
        text: tr('משימות'),
        count: nonZero(tasks.open.length),
        spoken: tr('משימות, {0} פתוחות', tasks.open.length),
      },
      quotes: {
        text: tr('הצעות'),
        count:
          openValue > 0
            ? `${quotes.list.length} · ${shekel.format(openValue)}`
            : nonZero(quotes.list.length),
        spoken:
          openValue > 0
            ? tr('הצעות, {0} · {1} פתוח', quotes.list.length, shekel.format(openValue))
            : tr('הצעות, {0}', quotes.list.length),
      },
      appointments: {
        text: tr('פגישות'),
        count: nonZero(appts.upcoming),
        spoken: tr('פגישות, {0} קרובות', appts.upcoming),
      },
    };
  const tabRefs = useRef<Partial<Record<LeadTab, HTMLButtonElement | null>>>({});
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, at: number) => {
    const forward = isRtl() ? 'ArrowLeft' : 'ArrowRight';
    const backward = isRtl() ? 'ArrowRight' : 'ArrowLeft';
    let to: number | null = null;
    if (e.key === forward) to = (at + 1) % LEAD_TABS.length;
    else if (e.key === backward) to = (at - 1 + LEAD_TABS.length) % LEAD_TABS.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = LEAD_TABS.length - 1;
    if (to === null) return;
    e.preventDefault();
    const next = LEAD_TABS[to]!;
    onSelect(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <section aria-label={tr('שיחה, הערות ומשימות')}>
      <div className="flex items-start gap-2 border-b border-surface-border px-3 pt-2">
        {/* Wraps instead of scrolling sideways on narrow screens. */}
        <div role="tablist" aria-label={tr('חלקי הליד')} className="flex min-w-0 flex-1 flex-wrap">
          {LEAD_TABS.map((t, i) => {
            const l = labels[t];
            return (
              <button
                key={t}
                ref={(el) => {
                  tabRefs.current[t] = el;
                }}
                id={`lead-tab-${t}`}
                type="button"
                role="tab"
                aria-selected={tab === t}
                aria-controls={`lead-panel-${t}`}
                aria-label={l.spoken}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => onSelect(t)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={cn(
                  '-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400',
                  tab === t
                    ? 'border-brand-600 text-brand-700'
                    : 'border-transparent text-ink-muted hover:text-ink',
                )}
              >
                {(() => {
                  const Icon = TAB_ICONS[t];
                  return (
                    <Icon aria-hidden className={cn('h-4 w-4 shrink-0', TAB_ICON_COLORS[t])} />
                  );
                })()}
                <span aria-hidden>{l.text}</span>
                {l.count !== undefined && (
                  <span
                    aria-hidden
                    className={cn(
                      'rounded-full px-1.5 text-xs',
                      l.alert
                        ? 'bg-success-600 font-semibold text-white'
                        : 'bg-surface-muted font-normal text-ink-muted',
                    )}
                  >
                    {l.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div
        id={`lead-panel-${tab}`}
        role="tabpanel"
        tabIndex={-1}
        aria-labelledby={`lead-tab-${tab}`}
        className="p-2 sm:p-3 [&>*]:border-0 [&>*]:shadow-none"
      >
        {children}
      </div>
    </section>
  );
}

function SourceProperty({ lead }: { lead: Lead }) {
  const [open, setOpen] = useState(false);
  const rows = attributionRows(lead.attribution);
  const panelId = `lead-source-details-${lead.id}`;
  return (
    <Property label={tr('מקור')}>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5">
          <LeadSourceIcon source={lead.source} className="h-4 w-4" />
          {lead.attribution
            ? attributionSourceName(lead.attribution)
            : tr(leadSourceLabels[lead.source])}
        </span>
        {/* When it came, on the same line (owner, 2026-11-28: one row instead of two). */}
        <span className="text-ink-muted">
          ·{' '}
          <time dateTime={lead.createdAt} title={formatDateTime(lead.createdAt)}>
            {timeAgo(lead.createdAt)}
          </time>
        </span>
        {rows.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-0.5 rounded text-xs font-medium text-brand-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            {tr('פרטים')}
            <ChevronDown
              aria-hidden
              className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
            />
          </button>
        )}
      </span>
      {open && (
        <div id={panelId} className="mt-2">
          <AttributionDetails rows={rows} />
        </div>
      )}
    </Property>
  );
}

/**
 * A row of the properties: the label and the value side by side (owner, 2026-11-28).
 * `labelForControl`: the control inside has its own (screen-reader) label, so the visible one is
 * hidden from assistive tech to avoid reading it twice.
 */
function Property({
  label,
  children,
  labelForControl = false,
  labelId,
}: {
  label: string;
  children: ReactNode;
  labelForControl?: boolean;
  labelId?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        id={labelId}
        aria-hidden={labelForControl || undefined}
        className="w-24 shrink-0 text-sm text-ink-muted"
      >
        {label}
      </span>
      <div className="min-w-0 flex-1 text-sm text-ink">{children}</div>
    </div>
  );
}

/** D-212/F35: the contact's other leads; an older server sends none, so nothing shows. */
function relatedLeadsOf(data: LeadDetailResponse): RelatedLead[] {
  return data.relatedLeads ?? [];
}

const relatedDateFmt = new Intl.DateTimeFormat(intlLocale(), { dateStyle: 'medium' });

function RelatedLeads({ businessId, related }: { businessId: string; related: RelatedLead[] }) {
  const base = businessWebPaths.section(businessId, 'leads');
  return (
    <ul aria-label={tr('לידים קשורים')} className="flex flex-col gap-1">
      {related.map((r) => {
        const amount = leadValueForStageKind(r.value, r.stage.kind);
        return (
          <li key={r.id}>
            <Link
              to={`${base}/${r.id}`}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <span className="font-medium text-brand-700">
                {tr('ליד מ־{0}', relatedDateFmt.format(new Date(r.createdAt)))}
              </span>
              <span className="text-xs text-ink-muted">
                {tr(r.stage.name)}
                {amount > 0 && ` · ${shekel.format(amount)}`}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Phones only (D-211): call, WhatsApp and "+ משימה" stay at hand in a bar fixed to the bottom
 * (above the device's home indicator; the page leaves room for it, and the help button keeps its
 * corner).
 */
function QuickBar({
  phone,
  whatsappInApp,
  onOpenConversation,
  onAddTask,
}: {
  phone: string | null;
  whatsappInApp: boolean;
  onOpenConversation: () => void;
  onAddTask: () => void;
}) {
  const item =
    'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium';
  return (
    <nav
      aria-label={tr('פעולות מהירות')}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-surface-border bg-surface/95 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pe-20 ps-3 pt-2 backdrop-blur lg:hidden print:hidden"
    >
      <div className="flex gap-2">
        {phone && (
          <a href={`tel:${phone}`} className={cn(item, 'bg-brand-600 text-white')}>
            <Phone aria-hidden className="h-4 w-4 shrink-0" />
            {tr('התקשרות')}
          </a>
        )}
        <WhatsAppAction
          phone={phone}
          inApp={whatsappInApp}
          onOpen={onOpenConversation}
          className={cn(item, 'bg-success-50 text-success-600 ring-1 ring-success-600/30')}
        />
        <button
          type="button"
          onClick={onAddTask}
          className={cn(item, 'bg-surface text-ink ring-1 ring-surface-border')}
        >
          {tr('+ משימה')}
        </button>
      </div>
    </nav>
  );
}

function DeleteLead({ lead, leave }: { lead: Lead; leave: (go: () => void) => void }) {
  const business = useCurrentBusiness();
  const remove = useDeleteLead(business.id);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const confirm = async () => {
    await remove.mutateAsync(lead.id);
    // Unsaved details of a deleted lead don't hold the way back.
    leave(() => navigate(businessWebPaths.section(business.id, 'leads'), { replace: true }));
  };

  return (
    <>
      <MoreMenu>
        <Button variant="ghost" size="sm" className="text-danger-600" onClick={() => setOpen(true)}>
          <Trash2 aria-hidden className="h-4 w-4" />
          {tr('מחיקת הליד')}
        </Button>
      </MoreMenu>
      <DialogShell
        open={open}
        onOpenChange={setOpen}
        title={tr('למחוק את הליד של {0}?', lead.contact.name)}
      >
        <p className="text-sm text-ink-muted">
          {tr(
            'הפנייה, ההערות וההיסטוריה שלה יימחקו לצמיתות. משימות שקשורות לליד יישארו, בלי הקישור. אם אין לאיש הקשר פניות נוספות, גם פרטיו יימחקו. אי אפשר לבטל את הפעולה.',
          )}
        </p>
        {remove.isError && <Alert tone="danger">{errorMessage(remove.error)}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {tr('ביטול')}
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => void confirm()}>
            {tr('מחיקה לצמיתות')}
          </Button>
        </div>
      </DialogShell>
    </>
  );
}
