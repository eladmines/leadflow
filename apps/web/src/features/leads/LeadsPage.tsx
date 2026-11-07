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
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Inbox,
  List,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  Search,
  SlidersHorizontal,
  UserRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  buttonClasses,
  MoreMenu,
  RefreshButton,
  Spinner,
} from '../../components/ui';
import { inputClasses } from '../../components/ui/Field';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { useMembers } from '../businesses/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import { useSite } from '../site/api';
import {
  leadsQueryKey,
  shekel,
  timeAgo,
  useLeads,
  useLeadTags,
  usePipeline,
  useUpdateLead,
} from './api';
import { NewLeadDialog } from './NewLeadDialog';
import { stageColor } from './stageColors';
import { useWhatsAppInbox } from '../whatsapp/api';
import { tr, intlLocale } from '../../i18n';

const leadPath = (businessId: string, leadId: string) =>
  `${businessWebPaths.section(businessId, 'leads')}/${leadId}`;

/**
 * What the lead said: the latest WhatsApp message when there is one (who wrote it and when),
 * otherwise the original enquiry.
 */
function LeadPreview({ lead, compact = false }: { lead: Lead; compact?: boolean }) {
  const last = lead.lastWhatsApp;
  if (!last) {
    if (!lead.message) return null;
    return compact ? (
      <p className="line-clamp-2 text-xs text-ink-muted">{lead.message}</p>
    ) : (
      <p className="line-clamp-3 whitespace-pre-line text-sm text-ink">{lead.message}</p>
    );
  }
  return (
    <div className={cn('flex flex-col gap-0.5', compact ? 'text-xs' : 'text-sm')}>
      <p className="flex items-center gap-1 text-xs text-ink-muted">
        <MessageCircle aria-hidden className="h-3.5 w-3.5 text-success-600" />
        {last.direction === 'IN' ? tr('הודעה אחרונה מהלקוח') : tr('התשובה האחרונה שלכם')} ·{' '}
        <time dateTime={last.createdAt}>{timeAgo(last.createdAt)}</time>
      </p>
      <p
        className={cn(
          'whitespace-pre-line',
          compact ? 'line-clamp-2 text-ink-muted' : 'line-clamp-3 text-ink',
        )}
      >
        {last.body}
      </p>
    </div>
  );
}

/** Points owners/managers to WhatsApp numbers waiting to be classified (D-092). */
function InboxNotice({ businessId }: { businessId: string }) {
  const inbox = useWhatsAppInbox(businessId);
  const count = inbox.data?.numbers.length ?? 0;
  if (count === 0) return null;
  return (
    <Alert tone="info">
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <MessageCircle aria-hidden className="h-4 w-4 text-success-600" />
        {count === 1
          ? tr('מספר חדש כתב בוואטסאפ')
          : tr('{0} מספרים חדשים כתבו בוואטסאפ', count)}{' '}
        {tr('ומחכים לסיווג (לקוח או פרטי).')}
        <Link
          to={businessWebPaths.section(businessId, 'conversations')}
          className="font-medium underline"
        >
          {tr('לשיחות')}
        </Link>
      </span>
    </Alert>
  );
}

/** List view card. */
function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <ul aria-label={tr('תגיות')} className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <li key={t} className="rounded-full bg-accent-50 px-2 py-0.5 text-xs text-accent-700">
          {t}
        </li>
      ))}
    </ul>
  );
}

function LeadCard({
  lead,
  stages,
  businessId,
}: {
  lead: Lead;
  stages: PipelineStage[];
  businessId: string;
}) {
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
              {tr(leadSourceLabels[lead.source])} ·{' '}
              <time
                dateTime={lead.createdAt}
                title={new Date(lead.createdAt).toLocaleString(intlLocale())}
              >
                {timeAgo(lead.createdAt)}
              </time>
              {lead.owner && ` · ${lead.owner.name}`}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
            stageColor(lead.stage, stages).tag,
          )}
        >
          {tr(lead.stage.name)}
        </span>
      </header>
      <LeadPreview lead={lead} />
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
      className="flex cursor-grab flex-col gap-2 rounded-xl border border-accent-300/80 bg-surface p-3 shadow-card hover:border-brand-300 active:cursor-grabbing"
    >
      <h3 className="text-sm font-semibold text-ink">
        <Link to={leadPath(businessId, lead.id)} className="hover:underline">
          {lead.contact.name}
        </Link>
      </h3>
      <LeadPreview lead={lead} compact />
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
        {tr('העברת')} {lead.contact.name} {tr('לשלב')}
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
            {tr(s.name)}
          </option>
        ))}
      </select>
    </article>
  );
}

/**
 * Side scrolling for the board: whether there are stages before/after the visible ones, and a
 * step of about one column. Works in both directions (in RTL, scrollLeft runs negative).
 */
function useBoardScroll(
  /** Re-measures when this changes (the board mounts after its data loads). */
  layoutKey: string,
) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ canBack: false, canForward: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft);
    setEdges({ canBack: pos > 4, canForward: max - pos > 4 });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure, layoutKey]);
  const scroll = (direction: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    el.scrollBy({ left: direction * (rtl ? -1 : 1) * 304, behavior: 'smooth' });
  };
  return { ref, scroll, ...edges };
}
type BoardScroll = ReturnType<typeof useBoardScroll>;

/** "Earlier / later stages" buttons, shown in the toolbar when stages are out of view. */
function BoardArrows({ scroller }: { scroller: BoardScroll }) {
  if (!scroller.canBack && !scroller.canForward) return null;
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => scroller.scroll(-1)}
        disabled={!scroller.canBack}
        aria-label={tr('לשלבים הקודמים')}
        title={tr('לשלבים הקודמים')}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-surface-border bg-surface text-ink-muted hover:text-ink disabled:opacity-40"
      >
        <ChevronLeft aria-hidden className="h-4 w-4 rtl:-scale-x-100" />
      </button>
      <button
        type="button"
        onClick={() => scroller.scroll(1)}
        disabled={!scroller.canForward}
        aria-label={tr('לשלבים הבאים')}
        title={tr('לשלבים הבאים')}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-surface-border bg-surface text-ink-muted hover:text-ink disabled:opacity-40"
      >
        <ChevronRight aria-hidden className="h-4 w-4 rtl:-scale-x-100" />
      </button>
    </div>
  );
}

function Board({
  leads,
  stages,
  businessId,
  scroller,
}: {
  leads: Lead[];
  stages: PipelineStage[];
  businessId: string;
  scroller: BoardScroll;
}) {
  const update = useUpdateLead(businessId);
  const [over, setOver] = useState<string | null>(null);
  const move = (lead: Lead, stage: PipelineStage) => {
    if (lead.stage.id === stage.id) return;
    update.mutate({
      leadId: lead.id,
      body: { stageId: stage.id },
      stage: { id: stage.id, name: tr(stage.name), kind: stage.kind },
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
          it), so off-screen columns can't widen the page. The scrollbar stays visible. */}
      <div
        ref={scroller.ref}
        className="scrollbar-visible relative -mx-4 overflow-x-auto px-4 pb-3"
      >
        <ol aria-label={tr('לוח לידים')} className="flex min-w-max gap-4">
          {stages.map((stage) => {
            const items = leads.filter((l) => l.stage.id === stage.id);
            const color = stageColor(stage, stages);
            const total = items.reduce((sum, l) => sum + (l.expectedValue ?? 0), 0);
            return (
              <li
                key={stage.id}
                aria-label={tr('{0}: {1} לידים', tr(stage.name), items.length)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(stage.id);
                }}
                onDragLeave={() => setOver((o) => (o === stage.id ? null : o))}
                onDrop={(e) => onDrop(e, stage)}
                className={cn(
                  'relative flex w-72 shrink-0 flex-col gap-3 overflow-hidden rounded-xl border border-surface-border bg-surface-muted p-3 pt-4 transition-colors',
                  over === stage.id && 'bg-brand-50 ring-2 ring-brand-300',
                )}
              >
                {/* Each stage in its colour (D-138). */}
                <span aria-hidden className={cn('absolute inset-x-0 top-0 h-1', color.bar)} />
                <div className="flex items-center justify-between border-b border-surface-border px-1 pb-2.5">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <span aria-hidden className={cn('h-2.5 w-2.5 rounded-full', color.dot)} />
                    {tr(stage.name)}
                    <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted ring-1 ring-surface-border">
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
  const queryClient = useQueryClient();
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
  const activeFilters = [query.stageId, query.ownerId, query.source, query.tag].filter(
    Boolean,
  ).length;
  // Filters sit behind one button (D-138); open on arrival when some are already on.
  const [filtersOpen, setFiltersOpen] = useState(activeFilters > 0);
  const clearFilters = () =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const k of ['stageId', 'ownerId', 'source', 'tag']) next.delete(k);
        return next;
      },
      { replace: true },
    );
  const view = params.get('view') === 'list' ? 'list' : 'board';
  const scroller = useBoardScroll(`${view}:${stages.data?.length ?? 0}:${leads.data?.length ?? 0}`);

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
    () => LEAD_SOURCES.map((s) => ({ value: s, label: tr(leadSourceLabels[s]) })),
    [],
  );
  const selectClass = cn(
    inputClasses(false).replace('w-full', 'w-auto'),
    'min-w-36 cursor-pointer',
  );

  return (
    <>
      <NewLeadDialog open={newOpen} onOpenChange={setNewOpen} />
      {can(business.role, 'whatsapp.inbox') && <InboxNotice businessId={business.id} />}

      {/* One panel (D-116): the toolbar on top, the board or list under it. */}
      <section
        aria-label={tr('פניות')}
        className="overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-card"
      >
        <PageHeader
          inPanel
          title={tr('לקוחות ולידים')}
          description={
            seesAll ? tr('כל הפניות של העסק, לפי שלב בתהליך המכירה.') : tr('הפניות שהוקצו לך.')
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setNewOpen(true)}>
                <Plus aria-hidden className="h-4 w-4" />
                {tr('ליד חדש')}
              </Button>
              {/* The rest behind "More" (D-138): one main action per page. */}
              <MoreMenu>
                <RefreshButton
                  onRefresh={() =>
                    Promise.all([
                      // Leads, tags and the WhatsApp notice (new numbers waiting).
                      queryClient.invalidateQueries({ queryKey: leadsQueryKey(business.id) }),
                      queryClient.invalidateQueries({
                        queryKey: ['businesses', business.id, 'whatsapp'],
                      }),
                    ])
                  }
                />
                {can(business.role, 'leads.export') && (
                  <a
                    // Plain link: the browser downloads the CSV with the session cookie.
                    href={`${apiPaths.leads.exportCsv(business.id)}${params.toString() ? `?${exportParams(params)}` : ''}`}
                    download
                    className={buttonClasses('secondary', 'md')}
                  >
                    <Download aria-hidden className="h-4 w-4" />
                    {tr('ייצוא לאקסל')}
                  </a>
                )}
              </MoreMenu>
            </div>
          }
        />
        <div
          role="search"
          className="flex flex-wrap items-center gap-3 border-b border-surface-border bg-surface p-4"
        >
          <div className="relative min-w-60 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
            />
            <label htmlFor="lead-search" className="sr-only">
              {tr('חיפוש לידים')}
            </label>
            <input
              id="lead-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tr('חיפוש לפי שם, טלפון או אימייל')}
              className={cn(inputClasses(false), 'ps-9')}
            />
          </div>
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="lead-filters"
            onClick={() => setFiltersOpen((o) => !o)}
            className={buttonClasses(activeFilters ? 'primary' : 'secondary', 'md')}
          >
            <SlidersHorizontal aria-hidden className="h-4 w-4" />
            {tr('סינון')}
            {activeFilters > 0 && (
              <span className="rounded-full bg-white/25 px-1.5 text-xs tabular-nums">
                {activeFilters}
              </span>
            )}
          </button>
          <div
            role="group"
            aria-label={tr('תצוגה')}
            className="flex rounded-xl bg-surface-sunken p-1"
          >
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
                {v === 'board' ? tr('לוח') : tr('רשימה')}
              </button>
            ))}
          </div>
          {view === 'board' && <BoardArrows scroller={scroller} />}
        </div>

        {filtersOpen && (
          <div
            id="lead-filters"
            role="group"
            aria-label={tr('סינון')}
            className="flex flex-wrap items-center gap-3 border-b border-surface-border bg-surface-muted px-4 py-3"
          >
            {view === 'list' && (
              <select
                aria-label={tr('סינון לפי שלב')}
                value={query.stageId ?? ''}
                onChange={(e) => setParam('stageId', e.target.value || undefined)}
                className={selectClass}
              >
                <option value="">{tr('כל השלבים')}</option>
                {stages.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {tr(s.name)}
                  </option>
                ))}
              </select>
            )}
            {seesAll && (
              <select
                aria-label={tr('סינון לפי אחראי')}
                value={query.ownerId ?? ''}
                onChange={(e) => setParam('ownerId', e.target.value || undefined)}
                className={selectClass}
              >
                <option value="">{tr('כל האחראים')}</option>
                <option value="none">{tr('ללא אחראי')}</option>
                {members.data?.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label={tr('סינון לפי מקור')}
              value={query.source ?? ''}
              onChange={(e) => setParam('source', e.target.value || undefined)}
              className={selectClass}
            >
              <option value="">{tr('כל המקורות')}</option>
              {sourceOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {(tags.length > 0 || query.tag) && (
              <select
                aria-label={tr('סינון לפי תגית')}
                value={query.tag ?? ''}
                onChange={(e) => setParam('tag', e.target.value || undefined)}
                className={selectClass}
              >
                <option value="">{tr('כל התגיות')}</option>
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
            {activeFilters > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
              >
                <X aria-hidden className="h-4 w-4" />
                {tr('ניקוי הסינון')}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-4 p-4">
          {leads.isPending || stages.isPending ? (
            <Spinner label={tr('טוענים פניות…')} />
          ) : leads.isError || stages.isError ? (
            <Alert tone="danger" title={tr('לא הצלחנו לטעון את הפניות')}>
              {errorMessage(leads.error ?? stages.error)}
            </Alert>
          ) : leads.data.length === 0 && !filtered ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
                <Inbox aria-hidden className="h-7 w-7" />
              </span>
              <h2 className="text-lg font-semibold text-ink">{tr('עדיין אין פניות')}</h2>
              {!seesAll ? (
                <p className="max-w-md text-sm text-ink-muted">
                  {tr('כשיוקצו לך פניות, הן יופיעו כאן.')}
                </p>
              ) : site.data?.published ? (
                <p className="max-w-md text-sm text-ink-muted">
                  {tr('האתר באוויר עם טופס פנייה. שתפו את הכתובת')}{' '}
                  <bdi dir="ltr" className="font-medium text-ink">
                    {site.data.publicUrl?.replace(/^https?:\/\//, '')}
                  </bdi>{' '}
                  {tr('— כל פנייה תופיע כאן ותגיע אליך באימייל. אפשר גם להוסיף ליד ידנית.')}
                </p>
              ) : (
                <>
                  <p className="max-w-md text-sm text-ink-muted">
                    {tr(
                      'אחרי שהאתר יפורסם, כל פנייה מהטופס באתר תופיע כאן ותגיע אליך באימייל. אפשר גם להוסיף ליד ידנית.',
                    )}
                  </p>
                  {can(business.role, 'site.edit') && (
                    <Link
                      to={businessWebPaths.section(business.id, 'site')}
                      className={buttonClasses('secondary', 'md')}
                    >
                      {tr('לבניית האתר')}
                    </Link>
                  )}
                </>
              )}
            </div>
          ) : view === 'board' ? (
            <Board
              leads={leads.data}
              stages={stages.data}
              businessId={business.id}
              scroller={scroller}
            />
          ) : leads.data.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-muted">
              {tr('לא נמצאו לידים שמתאימים לחיפוש.')}
            </p>
          ) : (
            <>
              <p className="text-sm text-ink-muted" aria-live="polite">
                {leads.data.length} {tr('פניות')}
              </p>
              <ul aria-label={tr('פניות')} className="grid gap-4 lg:grid-cols-2">
                {leads.data.map((lead) => (
                  <li key={lead.id}>
                    <LeadCard lead={lead} stages={stages.data} businessId={business.id} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </>
  );
}
