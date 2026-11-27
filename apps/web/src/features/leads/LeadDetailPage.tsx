import {
  addNoteRequestSchema,
  businessWebPaths,
  can,
  formatIsraeliPhone,
  leadSourceLabels,
  type Activity,
  type AddNoteRequest,
  type Lead,
  MAX_LEAD_TAGS,
  appointmentStatusLabels,
  formatAgorot,
} from '@simplecatch/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Mail, MessageCircle, MessageSquareText, Phone, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
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
  ScrollTabs,
} from '../../components/ui';
import { inputClasses } from '../../components/ui/Field';
import { cn } from '../../lib/cn';
import { ApiError } from '../../lib/api';
import { errorMessage } from '../auth/serverErrors';
import { useMembers } from '../businesses/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import {
  formatDateTime,
  timeAgo,
  useAddNote,
  useDeleteLead,
  useLeadTags,
  useLeadDetail,
  usePipeline,
  useUpdateLead,
} from './api';
import { WhereFrom } from './Attribution';
import { WHATSAPP_REPLY_ID, WhatsAppThread } from '../whatsapp/WhatsAppThread';
import { useWhatsAppThread } from '../whatsapp/api';
import { LeadSourceIcon } from './SourceIcon';
import { isQuoteNeeded, QuoteNeededDialog } from './QuoteNeededDialog';
import {
  ArchivedFieldValues,
  CustomFieldChanges,
  useCustomFieldsDraft,
  WhatTheyAsked,
} from './CustomFieldsCard';
import {
  Fold,
  LEAD_SECTIONS,
  LeadAppointments,
  LeadQuotes,
  leadSectionButtonId,
  leadSectionId,
  NextAction,
  quotesSummary,
  useLeadAppointments,
  useLeadQuotes,
  type LeadSectionKey,
} from './LeadCards';
import { useUnsavedChangesGuard } from '../../lib/useUnsavedChangesGuard';
import { tr, intlLocale } from '../../i18n';

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

/** The stage, in the header; saves at once (a move that needs a quote offers to write one). */
function StageSelect({ lead }: { lead: Lead }) {
  const business = useCurrentBusiness();
  const stages = usePipeline(business.id);
  const update = useUpdateLead(business.id);
  const [needsQuote, setNeedsQuote] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <SelectMenu
        id="lead-stage"
        label={tr('שלב')}
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

/** Owner and tags ("עוד פרטים"); each change saves at once. */
function OwnerAndTags({ lead }: { lead: Lead }) {
  const business = useCurrentBusiness();
  const canAssign = can(business.role, 'leads.assign');
  const members = useMembers(business.id, canAssign);
  const update = useUpdateLead(business.id);
  const save = (body: Parameters<typeof update.mutate>[0]['body']) =>
    update.mutate({ leadId: lead.id, body });

  return (
    <div className="flex flex-col gap-4">
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
      {canAssign ? (
        <SelectMenu
          id="lead-owner"
          label={tr('אחראי')}
          value={lead.owner?.id ?? ''}
          onChange={(v) => save({ ownerId: v || null })}
          options={[
            { value: '', label: tr('ללא אחראי') },
            ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.fullName })),
          ]}
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          <span id="lead-owner-label" className="text-sm font-medium text-ink">
            {tr('אחראי')}
          </span>
          <p id="lead-owner" aria-labelledby="lead-owner-label" className="text-sm text-ink">
            {lead.owner?.name ?? tr('ללא אחראי')}
          </p>
        </div>
      )}
      <TagEditor tags={lead.tags} onChange={(tags) => save({ tags })} />
      {update.isPending && (
        <p role="status" className="text-xs text-ink-muted">
          {tr('שומר…')}
        </p>
      )}
    </div>
  );
}

/** The "הערות" tab (D-211): the team's notes only; system events are in the history. */
function Notes({ leadId, activities }: { leadId: string; activities: Activity[] }) {
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

/** Everything that happened on the lead, notes included ("עוד פרטים"). */
function History({ activities }: { activities: Activity[] }) {
  return (
    <section aria-labelledby="lead-history-title" className="flex flex-col gap-2">
      <h3 id="lead-history-title" className="text-sm font-semibold text-ink">
        {tr('היסטוריה')}
      </h3>
      <ol aria-label={tr('היסטוריית הליד')} className="flex flex-col">
        {activities.map((a) => (
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
 * The WhatsApp button (header and phone bar). When the business's WhatsApp is connected and this
 * lead's conversation runs on it, the button opens the conversation tab here and puts the cursor in
 * the reply box; otherwise (not connected, another channel, or no access to the conversation) it
 * opens wa.me in a new tab. The accessible name says which.
 */
function WhatsAppAction({
  phone,
  inApp,
  onOpen,
  className,
}: {
  phone: string | null;
  inApp: boolean;
  onOpen: () => void;
  className: string;
}) {
  const content = (
    <>
      <MessageCircle aria-hidden className="h-4 w-4 shrink-0" />
      WhatsApp
    </>
  );
  if (inApp) {
    return (
      <button
        type="button"
        aria-label={tr('WhatsApp: מעבר לשיחה בעמוד')}
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
      className={className}
    >
      {content}
    </a>
  );
}

/**
 * `/b/:businessId/leads/:leadId` (D-211): who (header with stage, call and WhatsApp), what to do
 * next (the nearest open task), what they asked, then the conversation and notes. Quotes,
 * appointments and "more details" are folded one-line sections.
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
  return <LeadPage lead={detail.data.lead} activities={detail.data.activities} />;
}

function LeadPage({ lead, activities }: { lead: Lead; activities: Activity[] }) {
  const business = useCurrentBusiness();
  const back = businessWebPaths.section(business.id, 'leads');
  const draft = useCustomFieldsDraft(lead);
  const guard = useUnsavedChangesGuard(draft.dirty);
  const quotes = useLeadQuotes(lead);
  const appts = useLeadAppointments(lead);
  const [params] = useSearchParams();
  // Old `?tab=tasks|appointments|quotes` links (D-209) open the matching section.
  const [asked] = useState(() => {
    const t = params.get('tab');
    return (LEAD_SECTIONS as readonly string[]).includes(t ?? '') ? (t as LeadSectionKey) : null;
  });
  const [open, setOpen] = useState<Record<LeadSectionKey, boolean>>(() => ({
    tasks: asked === 'tasks',
    appointments: asked === 'appointments',
    quotes: asked === 'quotes',
    more: asked === 'more',
  }));
  const toggle = (key: LeadSectionKey) => (o: boolean) => setOpen((s) => ({ ...s, [key]: o }));
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  useOldTabLinks(asked);

  const phone = lead.contact.phone;
  // The conversation the page already loads (the WhatsApp tab's query, shared from the cache).
  const thread = useWhatsAppThread(business.id, lead.id);
  const whatsappInApp = Boolean(
    thread.data?.connected && (thread.data.channel ?? 'whatsapp') === 'whatsapp',
  );
  const [tabParams, setTabParams] = useSearchParams();
  const currentTab = tabParams.get('tab');
  const [focusReply, setFocusReply] = useState(false);
  const openConversation = () => {
    setTabParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.set('tab', 'whatsapp');
        return next;
      },
      { replace: true },
    );
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
  }, [focusReply, currentTab]);
  const addTask = () => {
    setTaskFormOpen(true);
    document.getElementById('lead-next-title')?.scrollIntoView?.({ block: 'center' });
  };
  const quoteCount = quotes.query.isSuccess ? ` (${quotes.list.length})` : '';
  const apptCount = appts.query.isSuccess ? ` (${appts.ordered.length})` : '';

  return (
    // Room at the bottom on phones for the quick-actions bar.
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-24 lg:pb-0">
      <Link
        to={back}
        className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowRight aria-hidden className="h-4 w-4 ltr:rotate-180" />
        {tr('כל הלידים')}
      </Link>

      <section className="flex flex-col gap-4 rounded-2xl border border-surface-border bg-surface p-5 shadow-card">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-100 text-lg font-semibold text-accent-700"
          >
            {lead.contact.name.trim().charAt(0)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h1 className="truncate text-2xl font-semibold text-ink" dir="auto">
              {lead.contact.name}
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <LeadSourceIcon source={lead.source} className="h-4 w-4" />
                {tr(leadSourceLabels[lead.source])}
              </span>
              <span aria-hidden>·</span>
              <span>{timeAgo(lead.createdAt)}</span>
            </p>
          </div>
        </div>
        <StageSelect lead={lead} />
        {(phone || lead.contact.email || whatsappInApp) && (
          <div className="flex flex-wrap gap-2">
            {phone && (
              <>
                <a
                  href={`tel:${phone}`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                >
                  <Phone aria-hidden className="h-4 w-4" />
                  <bdi dir="ltr">{formatIsraeliPhone(phone)}</bdi>
                </a>
              </>
            )}
            <WhatsAppAction
              phone={phone}
              inApp={whatsappInApp}
              onOpen={openConversation}
              className="inline-flex items-center gap-1.5 rounded-xl bg-success-50 px-4 py-2 text-sm font-medium text-success-600 ring-1 ring-success-600/30 hover:bg-success-600/10"
            />
            {lead.contact.email && (
              <a
                href={`mailto:${lead.contact.email}`}
                className="inline-flex min-w-0 items-center gap-1.5 rounded-xl bg-surface px-4 py-2 text-sm text-ink ring-1 ring-surface-border hover:bg-surface-muted"
              >
                <Mail aria-hidden className="h-4 w-4 shrink-0" />
                <bdi dir="ltr" className="truncate">
                  {lead.contact.email}
                </bdi>
              </a>
            )}
          </div>
        )}
      </section>

      <NextAction
        lead={lead}
        formOpen={taskFormOpen}
        onFormOpenChange={setTaskFormOpen}
        tasksOpen={open.tasks}
        onTasksOpenChange={toggle('tasks')}
      />

      <WhatTheyAsked
        draft={draft}
        editing={editing}
        onEditingChange={setEditing}
        // A conversation lead's first message is the start of its conversation.
        message={lead.message && !CONVERSATION_SOURCES.includes(lead.source) ? lead.message : null}
      />

      <LeadTabs lead={lead} activities={activities} />

      <div className="flex flex-col gap-2">
        <Fold
          sectionKey="quotes"
          title={`${tr('הצעות מחיר')}${quoteCount}`}
          summary={quotesSummary(lead)}
          open={open.quotes}
          onOpenChange={toggle('quotes')}
        >
          <LeadQuotes lead={lead} quotes={quotes} />
        </Fold>
        <Fold
          sectionKey="appointments"
          title={`${tr('תורים')}${apptCount}`}
          summary={appts.upcoming > 0 ? tr('{0} קרובים', appts.upcoming) : undefined}
          open={open.appointments}
          onOpenChange={toggle('appointments')}
        >
          <LeadAppointments lead={lead} appts={appts} />
        </Fold>
        <Fold
          sectionKey="more"
          title={tr('עוד פרטים')}
          summary={`${tr(leadSourceLabels[lead.source])} · ${lead.owner?.name ?? tr('ללא אחראי')}`}
          open={open.more}
          onOpenChange={toggle('more')}
        >
          <p className="text-sm text-ink-muted">
            {tr('נוצר')} {formatDateTime(lead.createdAt)}
          </p>
          <OwnerAndTags lead={lead} />
          <ArchivedFieldValues lead={lead} />
          <WhereFrom attribution={lead.attribution} />
          <History activities={activities} />
        </Fold>
      </div>

      {can(business.role, 'leads.delete') && <DeleteLead lead={lead} leave={guard.leave} />}

      <QuickBar
        phone={phone}
        whatsappInApp={whatsappInApp}
        onOpenConversation={openConversation}
        onAddTask={addTask}
      />

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
    </div>
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

/** Focuses the section an old `?tab=` link asked for, and drops the parameter. */
function useOldTabLinks(asked: LeadSectionKey | null) {
  const [, setParams] = useSearchParams();
  useEffect(() => {
    if (!asked) return;
    document.getElementById(leadSectionId(asked))?.scrollIntoView?.({ block: 'start' });
    document.getElementById(leadSectionButtonId(asked))?.focus({ preventScroll: true });
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('tab');
        return next;
      },
      { replace: true },
    );
  }, [asked, setParams]);
}

const LEAD_TABS = ['whatsapp', 'notes'] as const;
type LeadTab = (typeof LEAD_TABS)[number];

/**
 * The conversation and notes (D-211), one at a time. The tab is kept in the address (`?tab=`); a
 * lead that came from a conversation opens on it.
 */
function LeadTabs({ lead, activities }: { lead: Lead; activities: Activity[] }) {
  const [params, setParams] = useSearchParams();
  const fallback: LeadTab =
    lead.source === 'whatsapp' ||
    lead.source === 'facebook' ||
    lead.source === 'instagram' ||
    lead.lastWhatsApp
      ? 'whatsapp'
      : 'notes';
  const asked = params.get('tab');
  const tab: LeadTab = (LEAD_TABS as readonly string[]).includes(asked ?? '')
    ? (asked as LeadTab)
    : fallback;
  const labels: Record<LeadTab, string> = {
    notes: tr('הערות'),
    // The conversation: WhatsApp, or Facebook for a lead that came from the Page (F23).
    whatsapp:
      lead.source === 'facebook'
        ? tr('פייסבוק')
        : lead.source === 'instagram'
          ? 'Instagram'
          : 'WhatsApp',
  };
  return (
    <section className="overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-card">
      <ScrollTabs
        label={tr('חלקי הליד')}
        activeKey={tab}
        className="border-b border-surface-border px-3"
      >
        {LEAD_TABS.map((t) => (
          <button
            key={t}
            id={`lead-tab-${t}`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={`lead-panel-${t}`}
            onClick={() =>
              setParams(
                (p) => {
                  const next = new URLSearchParams(p);
                  next.set('tab', t);
                  return next;
                },
                { replace: true },
              )
            }
            className={cn(
              '-mb-px shrink-0 border-b-2 px-3 py-3 text-sm font-medium transition-colors',
              tab === t
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {labels[t]}
          </button>
        ))}
      </ScrollTabs>
      {/* The parts keep their own cards; inside the tab they lose the frame. */}
      <div
        id={`lead-panel-${tab}`}
        tabIndex={-1}
        role="tabpanel"
        aria-labelledby={`lead-tab-${tab}`}
        className="p-2 sm:p-3 [&>*]:border-0 [&>*]:shadow-none"
      >
        {tab === 'notes' && <Notes leadId={lead.id} activities={activities} />}
        {tab === 'whatsapp' && <WhatsAppThread leadId={lead.id} />}
      </div>
    </section>
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
