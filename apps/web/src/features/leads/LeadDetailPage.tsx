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
  MAX_LEAD_TAGS,
  appointmentStatusLabels,
  formatAgorot,
} from '@simplecatch/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Mail,
  MessageCircle,
  MessageSquareText,
  Phone,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  buttonClasses,
  DialogShell,
  EmptyState,
  SelectMenu,
  Spinner,
  Textarea,
} from '../../components/ui';
import { inputClasses } from '../../components/ui/Field';
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
  useLeadTags,
  useLeadDetail,
  usePipeline,
  useUpdateLead,
} from './api';
import { AttributionDetails, attributionRows, attributionSourceName } from './Attribution';
import { stageColor } from './stageColors';
import { WHATSAPP_REPLY_ID, WhatsAppThread } from '../whatsapp/WhatsAppThread';
import { useWhatsAppThread } from '../whatsapp/api';
import { LeadSourceIcon } from './SourceIcon';
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

/** Old history entries keep their labels (the fields were removed by D-207 and D-209). */
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
            ? tr('הלקוח ביקש בוואטסאפ תור ל')
            : tr('הלקוח קבע בוואטסאפ תור ל')
          : d.requested
            ? tr('התקבלה מהאתר בקשה לתור ל')
            : tr('נקבע תור ל')
      }${apptWhen(d.startsAt)}${d.service ? ` (${String(d.service)})` : ''}`;
    case 'appointment.updated':
      return tr(
        'התור עודכן: {0} · {1}',
        apptWhen(d.startsAt),
        tr(appointmentStatusLabels[d.status as keyof typeof appointmentStatusLabels]) ?? '',
      );
  }
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const business = useCurrentBusiness();
  const suggestions = useLeadTags(business.id).data ?? [];
  const [text, setText] = useState('');
  const full = tags.length >= MAX_LEAD_TAGS;
  const add = () => {
    const tag = text.trim().slice(0, 30);
    setText('');
    if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase())) onChange([...tags, tag]);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="lead-tag" className="text-sm font-medium text-ink">
        {tr('תגיות')}
      </label>
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <li
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-accent-50 py-0.5 pe-1 ps-2.5 text-sm text-accent-700"
            >
              {t}
              <button
                type="button"
                aria-label={tr('הסרת התגית {0}', t)}
                onClick={() => onChange(tags.filter((o) => o !== t))}
                className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-accent-100"
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          id="lead-tag"
          list="lead-tag-suggestions"
          value={text}
          maxLength={30}
          disabled={full}
          placeholder={full ? tr('הגעת למספר התגיות המרבי') : tr('למשל: VIP, חוזר, דחוף')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          className={inputClasses(false)}
        />
        <Button type="button" variant="secondary" disabled={full || !text.trim()} onClick={add}>
          {tr('הוספה')}
        </Button>
      </div>
      <datalist id="lead-tag-suggestions">
        {suggestions
          .filter((t) => !tags.includes(t))
          .map((t) => (
            <option key={t} value={t} />
          ))}
      </datalist>
    </div>
  );
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
      <SelectMenu
        id="lead-stage"
        label={tr('שלב')}
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
        <SelectMenu
          id="lead-owner"
          label={tr('אחראי')}
          value={lead.owner?.id ?? ''}
          onChange={(v) => update.mutate({ leadId: lead.id, body: { ownerId: v || null } })}
          options={[
            { value: '', label: tr('ללא אחראי') },
            ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.fullName })),
          ]}
        />
      ) : (
        <>
          <span id="lead-owner-label" className="text-sm font-medium text-ink">
            {tr('אחראי')}
          </span>
          <p id="lead-owner" aria-labelledby="lead-owner-label" className="text-sm text-ink">
            {lead.owner?.name ?? tr('ללא אחראי')}
          </p>
        </>
      )}
      <SaveState update={update} />
    </div>
  );
}

/** Tags; each change saves at once. */
function TagsField({ lead }: { lead: Lead }) {
  const business = useCurrentBusiness();
  const update = useUpdateLead(business.id);
  return (
    <div className="flex flex-col gap-1.5">
      <TagEditor
        tags={lead.tags}
        onChange={(tags) => update.mutate({ leadId: lead.id, body: { tags } })}
      />
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
    <section aria-labelledby="lead-history-title" className="flex flex-col gap-2">
      <h2 id="lead-history-title" className="text-base font-semibold text-ink">
        {tr('היסטוריה')}
      </h2>
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
 * The WhatsApp button ("תקשורת" and the phone bar). When the business's WhatsApp is connected and this
 * lead's conversation runs on it, the button opens the conversation tab here and puts the cursor in
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
 * lead's facts, communication, custom fields, related leads and history) first, then the
 * conversation, notes, tasks, quotes and appointments.
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
const INFO_ALIASES: readonly string[] = ['more', 'history', 'related'];

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
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab');
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [noteFocus, setNoteFocus] = useState(0);

  const phone = lead.contact.phone;
  // The conversation the page already loads (the WhatsApp tab's query, shared from the cache).
  const thread = useWhatsAppThread(business.id, lead.id);
  const whatsappInApp = Boolean(
    thread.data?.connected && (thread.data.channel ?? 'whatsapp') === 'whatsapp',
  );
  const messages = thread.data?.messages ?? [];
  const notes = activities.filter((a) => a.type === 'lead.note');

  // D-220: every tab is always shown; "מידע" unless the address asks for another.
  const tab: LeadTab =
    asked && (LEAD_TABS as readonly string[]).includes(asked) ? (asked as LeadTab) : 'info';

  const selectTab = (t: LeadTab) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set('tab', t);
        return next;
      },
      { replace: true },
    );

  // Old links (`?tab=more|history|related`) open "מידע"; the address says so.
  useEffect(() => {
    if (INFO_ALIASES.includes(asked ?? '')) selectTab('info');
    // Only for the address the page opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [focusReply, setFocusReply] = useState(false);
  const openConversation = () => {
    selectTab('whatsapp');
    setFocusReply(true);
  };
  // Once the conversation tab shows: the reply box, or the conversation when the reply window is
  // closed.
  useEffect(() => {
    if (!focusReply) return;
    const el =
      document.getElementById(WHATSAPP_REPLY_ID) ?? document.getElementById('lead-panel-whatsapp');
    if (!el) return;
    el.scrollIntoView?.({ block: 'center' });
    el.focus({ preventScroll: true });
    setFocusReply(false);
  }, [focusReply, tab]);

  const addTask = () => {
    selectTab('tasks');
    setTaskFormOpen(true);
  };
  const add = (what: AddKind) => {
    if (what === 'note') {
      selectTab('notes');
      setNoteFocus((n) => n + 1);
    } else if (what === 'task') addTask();
    else if (what === 'quote')
      navigate(`${businessWebPaths.section(business.id, 'quotes')}/new?leadId=${lead.id}`);
    else {
      selectTab('appointments');
      setBookOpen(true);
    }
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
    <div className={cn('mx-auto flex w-full max-w-4xl flex-col gap-4', !desktop && 'pb-24')}>
      <Link
        to={back}
        className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowRight aria-hidden className="h-4 w-4 ltr:rotate-180" />
        {tr('כל הלידים')}
      </Link>
      <h1 className="min-w-0 text-2xl font-semibold text-ink [overflow-wrap:anywhere]" dir="auto">
        {lead.contact.name}
      </h1>
      <div className="min-w-0 rounded-2xl border border-surface-border bg-surface shadow-card">
        <LeadTabArea
          lead={lead}
          tab={tab}
          onSelect={selectTab}
          onAdd={add}
          messages={messages}
          notes={notes}
          tasks={tasks}
          quotes={quotes}
          appts={appts}
        >
          {tab === 'info' && (
            <LeadInfo
              lead={lead}
              activities={activities}
              related={related}
              draft={draft}
              whatsappInApp={whatsappInApp}
              onOpenConversation={openConversation}
              messages={messages}
            />
          )}
          {tab === 'whatsapp' && <WhatsAppThread leadId={lead.id} />}
          {tab === 'notes' && <Notes leadId={lead.id} activities={activities} focus={noteFocus} />}
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
      {can(business.role, 'leads.delete') && <DeleteLead lead={lead} leave={guard.leave} />}
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

/** Customer's messages after the team's last reply (the conversation tab's "new" count). */
function awaitingReply(messages: WhatsAppMessage[]) {
  let n = 0;
  for (let i = messages.length - 1; i >= 0 && messages[i]!.direction === 'IN'; i--) n += 1;
  return n;
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
      <span className="ms-auto flex shrink-0 items-center gap-2">
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
 * "תקשורת", "פרטים" (custom fields; none defined → no section), related leads and the history.
 */
function LeadInfo({
  lead,
  activities,
  related,
  draft,
  whatsappInApp,
  onOpenConversation,
  messages,
}: {
  lead: Lead;
  activities: Activity[];
  related: RelatedLead[];
  draft: CustomFieldsDraft;
  whatsappInApp: boolean;
  onOpenConversation: () => void;
  messages: WhatsAppMessage[];
}) {
  const business = useCurrentBusiness();
  return (
    <div className="flex flex-col divide-y divide-surface-border px-2 sm:px-3 [&>*]:py-5 [&>*:first-child]:pt-2">
      <BasicInfo lead={lead} whatsappInApp={whatsappInApp} />
      <Communication
        lead={lead}
        whatsappInApp={whatsappInApp}
        onOpenConversation={onOpenConversation}
        messages={messages}
      />
      <CustomFieldsPanel draft={draft} />
      {related.length > 0 && (
        <section aria-labelledby="lead-related-title" className="flex flex-col gap-2">
          <h2 id="lead-related-title" className="text-base font-semibold text-ink">
            {tr('לידים קשורים')} ({related.length})
          </h2>
          <RelatedLeads businessId={business.id} related={related} />
        </section>
      )}
      <History activities={activities} />
    </div>
  );
}

/**
 * The lead's facts (D-220), each once (D-218): stage and owner (editable), source (+ details),
 * phone and email, value from quotes, created, tags, and what they asked (unless the conversation
 * already shows it).
 */
function BasicInfo({ lead, whatsappInApp }: { lead: Lead; whatsappInApp: boolean }) {
  const phone = lead.contact.phone;
  const email = lead.contact.email;
  const message = lead.message && !CONVERSATION_SOURCES.includes(lead.source) ? lead.message : null;
  return (
    <section aria-labelledby="lead-basic-title">
      <h2 id="lead-basic-title" className="sr-only">
        {tr('הליד')}
      </h2>
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <StageField lead={lead} />
        <OwnerField lead={lead} />
        <SourceProperty lead={lead} />
        <Property label={tr('נוצר')}>
          <time dateTime={lead.createdAt} title={timeAgo(lead.createdAt)}>
            {formatDateTime(lead.createdAt)}
          </time>
        </Property>
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
        <Property label={tr('ערך לפי הצעות מחיר')}>{valueSummary(lead)}</Property>
        <div className="sm:col-span-2">
          <TagsField lead={lead} />
        </div>
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

/**
 * "תקשורת" (D-219, D-220): "ממתין לתשובה שלך" when the customer wrote last, and the WhatsApp row
 * (in the page when connected, else wa.me). The phone and email, with copy, call and mail, are in
 * the facts above (each fact once, D-218).
 */
function Communication({
  lead,
  whatsappInApp,
  onOpenConversation,
  messages,
}: {
  lead: Lead;
  whatsappInApp: boolean;
  onOpenConversation: () => void;
  messages: WhatsAppMessage[];
}) {
  const phone = lead.contact.phone;
  const last = messages.at(-1);
  const waiting = last?.direction === 'IN' ? last : null;

  const row = Boolean(phone || whatsappInApp);
  const none = !row && !lead.contact.email;
  // Only an email (it is in the facts above) and nothing waiting: no section.
  if (!row && !waiting && !none) return null;
  return (
    <section aria-labelledby="lead-communication-title" className="flex flex-col gap-3">
      <h2 id="lead-communication-title" className="text-base font-semibold text-ink">
        {tr('תקשורת')}
      </h2>
      {none && <p className="text-sm text-ink-muted">{tr('אין פרטי קשר לליד הזה.')}</p>}
      {waiting && (
        <p className="flex items-center gap-1.5 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-600">
          <MessageCircle aria-hidden className="h-4 w-4 shrink-0" />
          <span>
            {tr('ממתין לתשובה שלך:')}{' '}
            <time dateTime={waiting.createdAt} title={formatDateTime(waiting.createdAt)}>
              {timeAgo(waiting.createdAt)}
            </time>
          </span>
        </p>
      )}
      {row && (
        <dl className="flex flex-col gap-1">
          <dt className="text-sm font-medium text-ink">WhatsApp</dt>
          <dd className="flex min-w-0 items-center gap-2 text-sm text-ink">
            <span className="min-w-0 flex-1 truncate text-ink-muted">
              {whatsappInApp ? tr('השיחה בעמוד הזה') : tr('נפתח בחלון חדש')}
            </span>
            <WhatsAppAction
              phone={phone}
              inApp={whatsappInApp}
              onOpen={onOpenConversation}
              iconOnly
              className={smallButton(whatsappInApp)}
            />
          </dd>
        </dl>
      )}
    </section>
  );
}

type AddKind = 'note' | 'task' | 'quote' | 'appointment';

/** "+" beside the tabs (D-219): add a note, task, quote or appointment — also to a hidden tab. */
function AddMenu({ onAdd }: { onAdd: (what: AddKind) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const items: { kind: AddKind; label: string }[] = [
    { kind: 'note', label: tr('הערה') },
    { kind: 'task', label: tr('משימה') },
    { kind: 'quote', label: tr('הצעת מחיר') },
    { kind: 'appointment', label: tr('תור') },
  ];
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(list.length - 1);
    else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'Tab') setOpen(false);
  };
  return (
    <div ref={rootRef} className="relative shrink-0" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={tr('הוספה לליד')}
        title={tr('הוספה לליד')}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-ink ring-1 ring-inset ring-surface-border hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <Plus aria-hidden className="h-5 w-5" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={tr('הוספה לליד')}
          className="absolute end-0 top-full z-30 mt-1 flex w-44 flex-col rounded-xl border border-surface-border bg-surface p-1 shadow-lift"
        >
          {items.map((it) => (
            <button
              key={it.kind}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                onAdd(it.kind);
              }}
              className="rounded-lg px-3 py-2 text-start text-sm text-ink hover:bg-surface-muted focus:bg-surface-muted focus:outline-none"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const LEAD_TABS = ['info', 'whatsapp', 'notes', 'tasks', 'quotes', 'appointments'] as const;
type LeadTab = (typeof LEAD_TABS)[number];

/**
 * D-219/D-220: one row of tabs — "מידע", then the conversation, notes, tasks, quotes and
 * appointments, each always shown with its count (read out too: "משימות, 3 פתוחות"); "+" adds an
 * item. The tab is in the address (`?tab=`). Arrow keys move between tabs (in the reading
 * direction), Home/End jump to the ends.
 */
function LeadTabArea({
  lead,
  tab,
  onSelect,
  onAdd,
  messages,
  notes,
  tasks,
  quotes,
  appts,
  children,
}: {
  lead: Lead;
  tab: LeadTab;
  onSelect: (tab: LeadTab) => void;
  onAdd: (what: AddKind) => void;
  messages: WhatsAppMessage[];
  notes: Activity[];
  tasks: ReturnType<typeof useLeadOpenTasks>;
  quotes: ReturnType<typeof useLeadQuotes>;
  appts: ReturnType<typeof useLeadAppointments>;
  children: ReactNode;
}) {
  const channel =
    lead.source === 'facebook'
      ? tr('פייסבוק')
      : lead.source === 'instagram'
        ? 'Instagram'
        : 'WhatsApp';
  const unread = awaitingReply(messages);
  const openValue = lead.value?.open ?? 0;
  const labels: Record<LeadTab, { text: string; count?: string; spoken: string; dot?: boolean }> = {
    info: { text: tr('מידע'), spoken: tr('מידע') },
    whatsapp: {
      text: channel,
      count: unread > 0 ? String(unread) : undefined,
      dot: unread > 0,
      spoken: unread > 0 ? tr('{0}, {1} הודעות חדשות', channel, unread) : channel,
    },
    notes: {
      text: tr('הערות'),
      count: String(notes.length),
      spoken: tr('הערות, {0}', notes.length),
    },
    tasks: {
      text: tr('משימות'),
      count: String(tasks.open.length),
      spoken: tr('משימות, {0} פתוחות', tasks.open.length),
    },
    quotes: {
      text: tr('הצעות'),
      count:
        openValue > 0
          ? `${quotes.list.length} · ${shekel.format(openValue)}`
          : String(quotes.list.length),
      spoken:
        openValue > 0
          ? tr('הצעות, {0} · {1} פתוח', quotes.list.length, shekel.format(openValue))
          : tr('הצעות, {0}', quotes.list.length),
    },
    appointments: {
      text: tr('תורים'),
      count: String(appts.upcoming),
      spoken: tr('תורים, {0} קרובים', appts.upcoming),
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
                {l.dot && <span aria-hidden className="h-2 w-2 rounded-full bg-success-600" />}
                <span aria-hidden>{l.text}</span>
                {l.count !== undefined && (
                  <span
                    aria-hidden
                    className="rounded-full bg-surface-muted px-1.5 text-xs font-normal text-ink-muted"
                  >
                    {l.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <AddMenu onAdd={onAdd} />
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

/** A row of the properties: its label, then the value. */
function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div className="text-sm text-ink">{children}</div>
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
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-danger-600"
        onClick={() => setOpen(true)}
      >
        <Trash2 aria-hidden className="h-4 w-4" />
        {tr('מחיקת הליד')}
      </Button>
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
