import {
  apiPaths,
  businessWebPaths,
  can,
  formatIsraeliPhone,
  LEAD_SOURCES,
  leadSourceLabels,
  type Lead,
  type LeadListQuery,
  type PipelineStage,
} from '@leadflow/shared';
import {
  Columns3,
  Download,
  Inbox,
  List,
  Mail,
  Phone,
  Plus,
  Search,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Button, buttonClasses, Spinner } from '../../components/ui';
import { inputClasses } from '../../components/ui/Field';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { useMembers } from '../businesses/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import { useSite } from '../site/api';
import { shekel, timeAgo, useLeads, useLeadTags, usePipeline, useUpdateLead } from './api';
import { NewLeadDialog } from './NewLeadDialog';

export const stageTone: Record<Lead['stage']['kind'], string> = {
  OPEN: 'bg-brand-50 text-brand-800',
  WON: 'bg-success-50 text-success-600',
  LOST: 'bg-surface-sunken text-ink-muted',
};

const leadPath = (businessId: string, leadId: string) =>
  `${businessWebPaths.section(businessId, 'leads')}/${leadId}`;

/** List view card. */
export function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <ul aria-label="תגיות" className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <li key={t} className="rounded-full bg-accent-50 px-2 py-0.5 text-xs text-accent-700">
          {t}
        </li>
      ))}
    </ul>
  );
}

export function LeadCard({ lead, businessId }: { lead: Lead; businessId: string }) {
  const phone = lead.contact.phone;
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-surface-border bg-surface p-4 shadow-card sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-100 font-semibold text-accent-700"
          >
            {lead.contact.name.trim().charAt(0)}
          </span>
          <div className="flex flex-col">
            <h2 className="font-semibold text-ink">
              <Link to={leadPath(businessId, lead.id)} className="hover:underline">
                {lead.contact.name}
              </Link>
            </h2>
            <p className="text-xs text-ink-muted">
              {leadSourceLabels[lead.source]} ·{' '}
              <time
                dateTime={lead.createdAt}
                title={new Date(lead.createdAt).toLocaleString('he-IL')}
              >
                {timeAgo(lead.createdAt)}
              </time>
              {lead.owner && ` · ${lead.owner.name}`}
            </p>
          </div>
        </div>
        <span
          className={cn('rounded-full px-2.5 py-1 text-xs font-medium', stageTone[lead.stage.kind])}
        >
          {lead.stage.name}
        </span>
      </header>
      {lead.message && (
        <p className="line-clamp-3 whitespace-pre-line text-sm text-ink">{lead.message}</p>
      )}
      <TagChips tags={lead.tags} />
      <div className="flex flex-wrap gap-2">
        {phone && (
          <a
            href={`tel:${phone}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 hover:bg-brand-100"
          >
            <Phone aria-hidden className="h-4 w-4" />
            <bdi dir="ltr">{formatIsraeliPhone(phone)}</bdi>
          </a>
        )}
        {lead.contact.email && (
          <a
            href={`mailto:${lead.contact.email}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-surface-muted px-3 py-1.5 text-sm text-ink hover:bg-surface-sunken"
          >
            <Mail aria-hidden className="h-4 w-4" />
            <bdi dir="ltr">{lead.contact.email}</bdi>
          </a>
        )}
      </div>
    </article>
  );
}

/** Compact board card: draggable, and a stage menu as the keyboard/touch alternative. */
function BoardCard({
  lead,
  stages,
  businessId,
  onMove,
}: {
  lead: Lead;
  stages: PipelineStage[];
  businessId: string;
  onMove: (lead: Lead, stage: PipelineStage) => void;
}) {
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/lead-id', lead.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="flex cursor-grab flex-col gap-2 rounded-2xl border border-surface-border bg-surface p-3 shadow-card active:cursor-grabbing"
    >
      <h3 className="text-sm font-semibold text-ink">
        <Link to={leadPath(businessId, lead.id)} className="hover:underline">
          {lead.contact.name}
        </Link>
      </h3>
      {lead.message && <p className="line-clamp-2 text-xs text-ink-muted">{lead.message}</p>}
      <TagChips tags={lead.tags} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <time dateTime={lead.createdAt}>{timeAgo(lead.createdAt)}</time>
        {lead.expectedValue !== null && (
          <span className="font-medium text-ink">{shekel.format(lead.expectedValue)}</span>
        )}
        {lead.owner && (
          <span className="inline-flex items-center gap-1">
            <UserRound aria-hidden className="h-3.5 w-3.5" />
            {lead.owner.name}
          </span>
        )}
      </div>
      <label className="sr-only" htmlFor={`move-${lead.id}`}>
        העברת {lead.contact.name} לשלב
      </label>
      <select
        id={`move-${lead.id}`}
        value={lead.stage.id}
        onChange={(e) => {
          const stage = stages.find((s) => s.id === e.target.value);
          if (stage) onMove(lead, stage);
        }}
        className="h-8 rounded-lg border border-surface-border bg-surface-muted px-2 text-xs text-ink"
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </article>
  );
}

function Board({
  leads,
  stages,
  businessId,
}: {
  leads: Lead[];
  stages: PipelineStage[];
  businessId: string;
}) {
  const update = useUpdateLead(businessId);
  const [over, setOver] = useState<string | null>(null);
  const move = (lead: Lead, stage: PipelineStage) => {
    if (lead.stage.id === stage.id) return;
    update.mutate({
      leadId: lead.id,
      body: { stageId: stage.id },
      stage: { id: stage.id, name: stage.name, kind: stage.kind },
    });
  };
  const onDrop = (e: DragEvent, stage: PipelineStage) => {
    e.preventDefault();
    setOver(null);
    const lead = leads.find((l) => l.id === e.dataTransfer.getData('text/lead-id'));
    if (lead) move(lead, stage);
  };

  return (
    <>
      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}
      {/* relative: the cards' sr-only labels are positioned inside the scroller (and clipped by
          it), so off-screen columns can't widen the page. */}
      <div className="relative -mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
        <ol aria-label="לוח לידים" className="flex min-w-max gap-4">
          {stages.map((stage) => {
            const items = leads.filter((l) => l.stage.id === stage.id);
            const total = items.reduce((sum, l) => sum + (l.expectedValue ?? 0), 0);
            return (
              <li
                key={stage.id}
                aria-label={`${stage.name}: ${items.length} לידים`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(stage.id);
                }}
                onDragLeave={() => setOver((o) => (o === stage.id ? null : o))}
                onDrop={(e) => onDrop(e, stage)}
                className={cn(
                  'flex w-72 shrink-0 flex-col gap-3 rounded-3xl bg-surface-sunken/70 p-3 transition-colors',
                  over === stage.id && 'bg-brand-50 ring-2 ring-brand-300',
                )}
              >
                <div className="flex items-center justify-between px-1">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <span
                      aria-hidden
                      className={cn(
                        'h-2.5 w-2.5 rounded-full',
                        stage.kind === 'WON'
                          ? 'bg-success-600'
                          : stage.kind === 'LOST'
                            ? 'bg-ink-subtle'
                            : 'bg-brand-500',
                      )}
                    />
                    {stage.name}
                    <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted">
                      {items.length}
                    </span>
                  </h2>
                  {total > 0 && (
                    <span className="text-xs text-ink-muted">{shekel.format(total)}</span>
                  )}
                </div>
                <ul className="flex min-h-24 flex-col gap-2">
                  {items.map((lead) => (
                    <li key={lead.id}>
                      <BoardCard
                        lead={lead}
                        stages={stages}
                        businessId={businessId}
                        onMove={move}
                      />
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}

/** The list filters, without UI-only params (view). */
function exportParams(params: URLSearchParams) {
  const p = new URLSearchParams(params);
  p.delete('view');
  p.delete('new');
  return p.toString();
}

/** F07/F08: leads as a pipeline board or a list, with search and filters kept in the URL. */
export function LeadsPage() {
  const business = useCurrentBusiness();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'list' ? 'list' : 'board';
  const seesAll = can(business.role, 'leads.view.all');
  const [q, setQ] = useState(params.get('q') ?? '');

  const query: LeadListQuery = {
    q: params.get('q') ?? undefined,
    stageId: params.get('stageId') ?? undefined,
    ownerId: (params.get('ownerId') as LeadListQuery['ownerId']) ?? undefined,
    source: (params.get('source') as LeadListQuery['source']) ?? undefined,
    tag: params.get('tag') ?? undefined,
  };
  const leads = useLeads(business.id, query);
  const stages = usePipeline(business.id);
  const members = useMembers(business.id, can(business.role, 'members.view'));
  const site = useSite(business.id);
  // `?new=1` (from quick search) opens the new-lead dialog.
  const [newOpen, setNewOpenState] = useState(params.get('new') === '1');
  const setNewOpen = (open: boolean) => {
    setNewOpenState(open);
    if (!open && params.has('new')) {
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.delete('new');
          return next;
        },
        { replace: true },
      );
    }
  };
  const tags = useLeadTags(business.id).data ?? [];
  const filtered = Boolean(query.q || query.stageId || query.ownerId || query.source || query.tag);

  const setParam = (key: string, value: string | undefined) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  // Debounced search into the URL. Only when the text changed: a no-op update still navigates,
  // and a late timer could pull the user back here after they had already left the page.
  useEffect(() => {
    const next = q.trim() || undefined;
    if (next === (params.get('q') ?? undefined)) return;
    const t = setTimeout(() => setParam('q', next), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const sourceOptions = useMemo(
    () => LEAD_SOURCES.map((s) => ({ value: s, label: leadSourceLabels[s] })),
    [],
  );
  const selectClass = cn(
    inputClasses(false).replace('w-full', 'w-auto'),
    'min-w-36 cursor-pointer',
  );

  return (
    <>
      <PageHeader
        title="לקוחות ולידים"
        description={seesAll ? 'כל הפניות של העסק, לפי שלב בתהליך המכירה.' : 'הפניות שהוקצו לך.'}
        actions={
          <div className="flex flex-wrap gap-2">
            {can(business.role, 'leads.export') && (
              <a
                // Plain link: the browser downloads the CSV with the session cookie.
                href={`${apiPaths.leads.exportCsv(business.id)}${params.toString() ? `?${exportParams(params)}` : ''}`}
                download
                className={buttonClasses('secondary', 'md')}
              >
                <Download aria-hidden className="h-4 w-4" />
                ייצוא לאקסל
              </a>
            )}
            <Button onClick={() => setNewOpen(true)}>
              <Plus aria-hidden className="h-4 w-4" />
              ליד חדש
            </Button>
          </div>
        }
      />
      <NewLeadDialog open={newOpen} onOpenChange={setNewOpen} />

      <div role="search" className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
          />
          <label htmlFor="lead-search" className="sr-only">
            חיפוש לידים
          </label>
          <input
            id="lead-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="חיפוש לפי שם, טלפון או אימייל"
            className={cn(inputClasses(false), 'ps-9')}
          />
        </div>
        {view === 'list' && (
          <select
            aria-label="סינון לפי שלב"
            value={query.stageId ?? ''}
            onChange={(e) => setParam('stageId', e.target.value || undefined)}
            className={selectClass}
          >
            <option value="">כל השלבים</option>
            {stages.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {seesAll && (
          <select
            aria-label="סינון לפי אחראי"
            value={query.ownerId ?? ''}
            onChange={(e) => setParam('ownerId', e.target.value || undefined)}
            className={selectClass}
          >
            <option value="">כל האחראים</option>
            <option value="none">ללא אחראי</option>
            {members.data?.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.fullName}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="סינון לפי מקור"
          value={query.source ?? ''}
          onChange={(e) => setParam('source', e.target.value || undefined)}
          className={selectClass}
        >
          <option value="">כל המקורות</option>
          {sourceOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {(tags.length > 0 || query.tag) && (
          <select
            aria-label="סינון לפי תגית"
            value={query.tag ?? ''}
            onChange={(e) => setParam('tag', e.target.value || undefined)}
            className={selectClass}
          >
            <option value="">כל התגיות</option>
            {query.tag && !tags.includes(query.tag) && (
              <option value={query.tag}>{query.tag}</option>
            )}
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        <div role="group" aria-label="תצוגה" className="flex rounded-xl bg-surface-sunken p-1">
          {(['board', 'list'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setParam('view', v === 'board' ? undefined : 'list')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm',
                view === v ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted',
              )}
            >
              {v === 'board' ? (
                <Columns3 aria-hidden className="h-4 w-4" />
              ) : (
                <List aria-hidden className="h-4 w-4" />
              )}
              {v === 'board' ? 'לוח' : 'רשימה'}
            </button>
          ))}
        </div>
      </div>

      {leads.isPending || stages.isPending ? (
        <Spinner label="טוענים פניות…" />
      ) : leads.isError || stages.isError ? (
        <Alert tone="danger" title="לא הצלחנו לטעון את הפניות">
          {errorMessage(leads.error ?? stages.error)}
        </Alert>
      ) : leads.data.length === 0 && !filtered ? (
        <section className="flex flex-col items-center gap-3 rounded-3xl border border-surface-border bg-surface px-6 py-16 text-center shadow-card">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <Inbox aria-hidden className="h-7 w-7" />
          </span>
          <h2 className="text-lg font-semibold text-ink">עדיין אין פניות</h2>
          {!seesAll ? (
            <p className="max-w-md text-sm text-ink-muted">כשיוקצו לך פניות, הן יופיעו כאן.</p>
          ) : site.data?.published ? (
            <p className="max-w-md text-sm text-ink-muted">
              האתר באוויר עם טופס פנייה. שתפו את הכתובת{' '}
              <bdi dir="ltr" className="font-medium text-ink">
                {site.data.publicUrl?.replace(/^https?:\/\//, '')}
              </bdi>{' '}
              — כל פנייה תופיע כאן ותגיע אליך באימייל. אפשר גם להוסיף ליד ידנית.
            </p>
          ) : (
            <>
              <p className="max-w-md text-sm text-ink-muted">
                אחרי שהאתר יפורסם, כל פנייה מהטופס באתר תופיע כאן ותגיע אליך באימייל. אפשר גם להוסיף
                ליד ידנית.
              </p>
              {can(business.role, 'site.edit') && (
                <Link
                  to={businessWebPaths.section(business.id, 'site')}
                  className={buttonClasses('secondary', 'md')}
                >
                  לבניית האתר
                </Link>
              )}
            </>
          )}
        </section>
      ) : view === 'board' ? (
        <Board leads={leads.data} stages={stages.data} businessId={business.id} />
      ) : leads.data.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-muted">לא נמצאו לידים שמתאימים לחיפוש.</p>
      ) : (
        <>
          <p className="text-sm text-ink-muted" aria-live="polite">
            {leads.data.length} פניות
          </p>
          <ul aria-label="פניות" className="grid gap-4 lg:grid-cols-2">
            {leads.data.map((lead) => (
              <li key={lead.id}>
                <LeadCard lead={lead} businessId={business.id} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
