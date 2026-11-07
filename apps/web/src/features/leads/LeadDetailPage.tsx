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
  quoteStatusLabels,
} from '@leadflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Mail, MessageSquareText, Phone, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  buttonClasses,
  Card,
  DialogShell,
  EmptyState,
  Field,
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
import { stageColor } from './stageColors';
import { NewTaskForm } from '../tasks/NewTaskForm';
import { TaskItem } from '../tasks/TaskItem';
import { useTasks, toLocalInput } from '../tasks/api';
import { useAppointments } from '../appointments/api';
import { NewAppointmentDialog } from '../appointments/NewAppointmentDialog';
import { displayStatus, useQuotes } from '../quotes/api';
import { WhatsAppThread } from '../whatsapp/WhatsAppThread';
import { tr, intlLocale } from '../../i18n';

const fieldLabels: Record<string, string> = {
  expectedValue: tr('ערך משוער'),
  nextActionAt: tr('תאריך טיפול הבא'),
  message: tr('פרטי הפנייה'),
  tags: tr('תגיות'),
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

/** `<input type="datetime-local">` speaks local time without a zone. */
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

function Details({ lead }: { lead: Lead }) {
  const business = useCurrentBusiness();
  const stages = usePipeline(business.id);
  const canAssign = can(business.role, 'leads.assign');
  const members = useMembers(business.id, canAssign);
  const update = useUpdateLead(business.id);
  const [value, setValue] = useState(lead.expectedValue?.toString() ?? '');
  const [next, setNext] = useState(lead.nextActionAt ? toLocalInput(lead.nextActionAt) : '');
  const save = (body: Parameters<typeof update.mutate>[0]['body']) =>
    update.mutate({ leadId: lead.id, body });

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-ink">{tr('פרטי הטיפול')}</h2>
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="lead-stage" className="text-sm font-medium text-ink">
          {tr('שלב')}
        </label>
        <select
          id="lead-stage"
          value={lead.stage.id}
          onChange={(e) => save({ stageId: e.target.value })}
          className={cn(inputClasses(false), 'cursor-pointer')}
        >
          {stages.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {tr(s.name)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="lead-owner" className="text-sm font-medium text-ink">
          {tr('אחראי')}
        </label>
        {canAssign ? (
          <select
            id="lead-owner"
            value={lead.owner?.id ?? ''}
            onChange={(e) => save({ ownerId: e.target.value || null })}
            className={cn(inputClasses(false), 'cursor-pointer')}
          >
            <option value="">{tr('ללא אחראי')}</option>
            {members.data?.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.fullName}
              </option>
            ))}
          </select>
        ) : (
          <p id="lead-owner" className="text-sm text-ink">
            {lead.owner?.name ?? tr('ללא אחראי')}
          </p>
        )}
      </div>
      <TagEditor tags={lead.tags} onChange={(tags) => save({ tags })} />
      <Field
        label={tr('ערך משוער (₪)')}
        ltr
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => {
          const n = value ? Number(value) : null;
          if (n !== lead.expectedValue) save({ expectedValue: n });
        }}
      />
      <Field
        label={tr('תאריך טיפול הבא')}
        type="datetime-local"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        onBlur={() => {
          const iso = next ? new Date(next).toISOString() : null;
          if (iso !== lead.nextActionAt) save({ nextActionAt: iso });
        }}
      />
      {update.isPending && (
        <p role="status" className="text-xs text-ink-muted">
          {tr('שומר…')}
        </p>
      )}
    </Card>
  );
}

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

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-ink">{tr('הערות והיסטוריה')}</h2>
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
      <ol aria-label={tr('היסטוריית הליד')} className="flex flex-col">
        {activities.map((a) => (
          <li key={a.id} className="relative flex gap-3 pb-5 last:pb-0">
            <span
              aria-hidden
              className={cn(
                'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
                a.type === 'lead.note' ? 'bg-accent-500' : 'bg-brand-300',
              )}
            />
            <div className="flex flex-1 flex-col gap-0.5">
              {a.type === 'lead.note' ? (
                <p className="flex items-start gap-1.5 whitespace-pre-line rounded-xl bg-surface-muted p-3 text-sm text-ink">
                  <MessageSquareText
                    aria-hidden
                    className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted"
                  />
                  {activityText(a)}
                </p>
              ) : (
                <p className="text-sm text-ink">{activityText(a)}</p>
              )}
              <p className="text-xs text-ink-muted">
                {a.actor?.name ? `${a.actor.name} · ` : ''}
                <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>
                  {timeAgo(a.createdAt)}
                </time>
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function LeadTasks({ leadId }: { leadId: string }) {
  const business = useCurrentBusiness();
  const tasks = useTasks(business.id, { leadId });
  const open = (tasks.data ?? []).filter((t) => t.status === 'OPEN');
  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-ink">{tr('משימות')}</h2>
      {open.length > 0 ? (
        <ul aria-label={tr('משימות הליד')} className="divide-y divide-surface-border">
          {open.map((t) => (
            <TaskItem key={t.id} task={t} businessId={business.id} showLead={false} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">{tr('אין משימות פתוחות לליד הזה.')}</p>
      )}
      <NewTaskForm leadId={leadId} compact />
    </Card>
  );
}

/** `/b/:businessId/leads/:leadId`: contact, stage, owner, value, next action, notes, history. */
export function LeadDetailPage() {
  const business = useCurrentBusiness();
  const { leadId = '' } = useParams();
  const detail = useLeadDetail(business.id, leadId);
  const pipeline = usePipeline(business.id);
  const back = businessWebPaths.section(business.id, 'leads');

  if (detail.isPending) return <Spinner label={tr('טוענים את הליד…')} />;
  if (detail.isError) {
    if (detail.error instanceof ApiError && detail.error.status === 404) {
      return (
        <EmptyState
          title={tr('הליד לא נמצא')}
          description={tr('ייתכן שהקישור שגוי, או שהליד לא משויך אליך.')}
          action={
            <Link to={back} className="text-sm font-medium text-brand-700 underline">
              {tr('חזרה לכל הלידים')}
            </Link>
          }
        />
      );
    }
    return <Alert tone="danger">{errorMessage(detail.error)}</Alert>;
  }
  const { lead, activities } = detail.data;
  const phone = lead.contact.phone;
  const tone = stageColor(lead.stage, pipeline.data).tag;

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Link
          to={back}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
        >
          <ArrowRight aria-hidden className="h-4 w-4 ltr:rotate-180" />
          {tr('כל הלידים')}
        </Link>
      </div>
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-surface-border bg-surface p-6 shadow-card">
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-100 text-xl font-semibold text-accent-700"
          >
            {lead.contact.name.trim().charAt(0)}
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold text-ink">{lead.contact.name}</h1>
            <p className="text-sm text-ink-muted">
              {tr(leadSourceLabels[lead.source])} · {formatDateTime(lead.createdAt)}
              {lead.expectedValue !== null && ` · ${shekel.format(lead.expectedValue)}`}
            </p>
          </div>
        </div>
        <span className={cn('rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset', tone)}>
          {tr(lead.stage.name)}
        </span>
        <div className="flex w-full flex-wrap gap-2">
          {phone && (
            <a
              href={`tel:${phone}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              <Phone aria-hidden className="h-4 w-4" />
              <bdi dir="ltr">{formatIsraeliPhone(phone)}</bdi>
            </a>
          )}
          {lead.contact.email && (
            <a
              href={`mailto:${lead.contact.email}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-surface px-4 py-2 text-sm text-ink ring-1 ring-surface-border hover:bg-surface-muted"
            >
              <Mail aria-hidden className="h-4 w-4" />
              <bdi dir="ltr">{lead.contact.email}</bdi>
            </a>
          )}
        </div>
        {lead.message && (
          <p className="w-full whitespace-pre-line rounded-2xl bg-surface/80 p-4 text-sm text-ink">
            {lead.message}
          </p>
        )}
      </section>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <LeadTabs lead={lead} activities={activities} />
        <div className="flex flex-col gap-6 lg:order-first">
          <Details key={lead.updatedAt} lead={lead} />
        </div>
      </div>
      {can(business.role, 'leads.delete') && <DeleteLead lead={lead} />}
    </>
  );
}

const LEAD_TABS = ['notes', 'whatsapp', 'tasks', 'appointments', 'quotes'] as const;
type LeadTab = (typeof LEAD_TABS)[number];

/**
 * Everything about the lead beyond its details, one part at a time (D-140): notes and history,
 * WhatsApp, tasks, appointments, quotes. The tab is kept in the address (`?tab=`); a lead that
 * came from WhatsApp opens on the conversation.
 */
function LeadTabs({ lead, activities }: { lead: Lead; activities: Activity[] }) {
  const [params, setParams] = useSearchParams();
  const fallback: LeadTab = lead.source === 'whatsapp' || lead.lastWhatsApp ? 'whatsapp' : 'notes';
  const asked = params.get('tab');
  const tab: LeadTab = (LEAD_TABS as readonly string[]).includes(asked ?? '')
    ? (asked as LeadTab)
    : fallback;
  const labels: Record<LeadTab, string> = {
    notes: tr('הערות והיסטוריה'),
    whatsapp: 'WhatsApp',
    tasks: tr('משימות'),
    appointments: tr('תורים'),
    quotes: tr('הצעות מחיר'),
  };
  return (
    <section className="overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-card">
      <div
        role="tablist"
        aria-label={tr('חלקי הליד')}
        className="flex gap-1 overflow-x-auto border-b border-surface-border px-3"
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
      </div>
      {/* The parts keep their own cards; inside the tab they lose the frame. */}
      <div
        id={`lead-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`lead-tab-${tab}`}
        className="p-2 sm:p-3 [&>*]:border-0 [&>*]:shadow-none"
      >
        {tab === 'notes' && <Notes leadId={lead.id} activities={activities} />}
        {tab === 'whatsapp' && <WhatsAppThread leadId={lead.id} />}
        {tab === 'tasks' && <LeadTasks leadId={lead.id} />}
        {tab === 'appointments' && <LeadAppointments lead={lead} />}
        {tab === 'quotes' && <LeadQuotes leadId={lead.id} />}
      </div>
    </section>
  );
}

/** Appointments of this lead (last month to two months ahead) and a "book" button. */
function LeadAppointments({ lead }: { lead: Lead }) {
  const business = useCurrentBusiness();
  const [open, setOpen] = useState(false);
  const now = Date.now();
  const appts = useAppointments(business.id, {
    from: new Date(now - 30 * 86_400_000).toISOString(),
    to: new Date(now + 31 * 86_400_000).toISOString(),
    leadId: lead.id,
  });
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">{tr('תורים')}</h2>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          {tr('קביעת תור')}
        </Button>
      </div>
      {appts.data && appts.data.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {appts.data.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-ink">
                {apptWhen(a.startsAt)}
                {a.service && <span className="text-ink-muted"> · {a.service.name}</span>}
              </span>
              <span className="text-xs text-ink-muted">
                {tr(appointmentStatusLabels[a.status])}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">{tr('אין תורים קרובים.')}</p>
      )}
      <NewAppointmentDialog open={open} onOpenChange={setOpen} lead={lead} />
    </Card>
  );
}

/** Quotes for this lead and "new quote" (F18). */
function LeadQuotes({ leadId }: { leadId: string }) {
  const business = useCurrentBusiness();
  const quotes = useQuotes(business.id, { leadId });
  const base = businessWebPaths.section(business.id, 'quotes');
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">{tr('הצעות מחיר')}</h2>
        <Link to={`${base}/new?leadId=${leadId}`} className={buttonClasses('secondary', 'sm')}>
          {tr('הצעת מחיר חדשה')}
        </Link>
      </div>
      {quotes.data && quotes.data.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {quotes.data.map((q) => (
            <li key={q.id} className="flex items-center justify-between gap-2 text-sm">
              <Link to={`${base}/${q.id}`} className="text-brand-700 hover:underline">
                {tr('מס׳')} {q.number} · {formatAgorot(q.totals.total)}
              </Link>
              <span className="text-xs text-ink-muted">
                {tr(quoteStatusLabels[displayStatus(q)])}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">{tr('אין עדיין הצעות.')}</p>
      )}
    </Card>
  );
}

function DeleteLead({ lead }: { lead: Lead }) {
  const business = useCurrentBusiness();
  const remove = useDeleteLead(business.id);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const confirm = async () => {
    await remove.mutateAsync(lead.id);
    navigate(businessWebPaths.section(business.id, 'leads'), { replace: true });
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
