import {
  appointmentStatusLabels,
  can,
  type Appointment,
  type AppointmentStatus,
} from '@simplecatch/shared';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Settings2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  CollapseButton,
  EmptyState,
  SelectMenu,
  Spinner,
} from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { useMembers } from '../businesses/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { PageHeader } from '../shell/PageHeader';
import {
  addDays,
  dayFmt,
  sameDay,
  shortDayFmt,
  startOfDay,
  startOfWeek,
  timeFmt,
  toDateInput,
  useAppointmentRequests,
  useAppointments,
} from './api';
import { AppointmentDialog } from './AppointmentDialog';
import { NewAppointmentDialog } from './NewAppointmentDialog';
import { ServicesPanel } from './ServicesPanel';
import { TimeGrid, TimeGridLegend } from './TimeGrid';
import { tr } from '../../i18n';

/** Status tone + text (colour is never the only signal). */
const statusTone: Record<AppointmentStatus, string> = {
  REQUESTED: 'border-warning-600/40 bg-warning-50 text-warning-600',
  CONFIRMED: 'border-brand-200 bg-brand-50 text-brand-800',
  COMPLETED: 'border-success-600/30 bg-success-50 text-success-600',
  NO_SHOW: 'border-surface-border bg-surface-sunken text-ink-muted',
  CANCELLED: 'border-surface-border bg-surface text-ink-subtle line-through',
};

/** Pending requests as a table: when, who, what, and the status; a row opens the request. */
function RequestsTable({
  id,
  items,
  onOpen,
}: {
  id: string;
  items: Appointment[];
  onOpen: (a: Appointment) => void;
}) {
  const th = 'px-3 py-2 text-start font-medium';
  return (
    <div
      id={id}
      className="scrollbar-visible overflow-x-auto rounded-lg border border-surface-border bg-surface"
    >
      <table className="w-full min-w-[34rem] text-sm">
        <thead className="bg-surface-muted text-xs text-ink-muted">
          <tr>
            <th className={th}>{tr('תאריך')}</th>
            <th className={th}>{tr('שעות')}</th>
            <th className={th}>{tr('לקוח')}</th>
            <th className={th}>{tr('סוג')}</th>
            <th className={th}>{tr('סטטוס')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr
              key={a.id}
              onClick={() => onOpen(a)}
              className="cursor-pointer border-t border-surface-border first:border-t-0 hover:bg-surface-muted/60"
            >
              <td className="px-3 py-2.5 text-ink-muted">
                {shortDayFmt.format(new Date(a.startsAt))}
              </td>
              <td className="px-3 py-2.5">
                <bdi dir="ltr" className="tabular-nums text-ink">
                  {timeFmt.format(new Date(a.startsAt))}–{timeFmt.format(new Date(a.endsAt))}
                </bdi>
              </td>
              <td className="px-3 py-2.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(a);
                  }}
                  className="font-medium text-brand-700 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  {a.customer.name}
                </button>
              </td>
              <td className="px-3 py-2.5 text-ink-muted">
                {[a.service?.name, a.staff?.name].filter(Boolean).join(' · ') || '—'}
              </td>
              <td className="px-3 py-2.5">
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-xs font-medium',
                    statusTone[a.status],
                  )}
                >
                  {tr(appointmentStatusLabels[a.status])}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** F17: day/week calendar with free slots (D-101), pending website requests, and services. */
export function AppointmentsPage() {
  const business = useCurrentBusiness();
  const manager = can(business.role, 'appointments.view.all');
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'day' ? 'day' : 'week';
  const anchor = params.get('date') ? new Date(`${params.get('date')}T00:00`) : new Date();
  const staff = params.get('staff') ?? '';
  const from = view === 'day' ? startOfDay(anchor) : startOfWeek(anchor);
  const days = view === 'day' ? [from] : Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const to = addDays(from, days.length);

  const list = useAppointments(business.id, {
    from: from.toISOString(),
    to: to.toISOString(),
    staffId: staff || undefined,
  });
  const requests = useAppointmentRequests(business.id);
  const members = useMembers(business.id, manager);
  const [open, setOpen] = useState<Appointment | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  // F35: a task's link opens its appointment here (`?appointment=<id>`, on its day).
  const wanted = params.get('appointment');
  useEffect(() => {
    if (!wanted) return;
    const found = list.data?.find((x) => x.id === wanted);
    if (!found) return;
    setOpen(found);
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete('appointment');
        return next;
      },
      { replace: true },
    );
  }, [wanted, list.data, setParams]);
  const [servicesOpen, setServicesOpen] = useState(false);
  // Folded by default: the list can be long and the calendar is the page.
  const [requestsOpen, setRequestsOpen] = useState(false);
  const requestsId = useId();

  const set = (patch: Record<string, string | undefined>) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );
  const shift = (n: number) =>
    set({ date: toDateInput(addDays(from, n * (view === 'day' ? 1 : 7))) });

  // A slot is free while fewer appointments overlap it than people who can take them.
  const capacity = staff || !manager ? 1 : Math.max(1, (members.data ?? []).length);
  const [slot, setSlot] = useState<{ day: Date; time: string } | null>(null);
  const pending = (requests.data ?? []).filter((r) => r.status === 'REQUESTED');
  const today = new Date();
  const rangeLabel =
    view === 'day'
      ? dayFmt.format(from)
      : `${shortDayFmt.format(from)} – ${shortDayFmt.format(addDays(to, -1))}`;

  return (
    <>
      {servicesOpen && <ServicesPanel />}

      {/* One panel (D-116): the date controls on top, the calendar under it, the legend below. */}
      <section
        aria-label={tr('יומן')}
        className="overflow-hidden rounded-2xl border border-surface-border bg-surface shadow-card"
      >
        <PageHeader
          inPanel
          refresh
          title={tr('יומן')}
          description={tr('היומן של העסק: פגישות, בקשות מהאתר ושירותים.')}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => setNewOpen(true)}>
                <Plus aria-hidden className="h-4 w-4" />
                {tr('פגישה חדשה')}
              </Button>
              {manager && (
                <Button
                  variant="secondary"
                  aria-expanded={servicesOpen}
                  onClick={() => setServicesOpen((o) => !o)}
                >
                  <Settings2 aria-hidden className="h-4 w-4" />
                  {tr('שירותים')}
                </Button>
              )}
            </div>
          }
        />
        {pending.length > 0 && (
          <div className="border-b border-surface-border p-4">
            <Card className="flex flex-col gap-3 border-warning-600/30 bg-warning-50/60">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-ink">
                  {tr('בקשות ממתינות לאישור (')}
                  {pending.length})
                </h2>
                <CollapseButton
                  showText
                  collapsed={!requestsOpen}
                  onToggle={() => setRequestsOpen((o) => !o)}
                  controls={requestsId}
                  label={tr('בקשות ממתינות לאישור')}
                />
              </div>
              {requestsOpen && <RequestsTable id={requestsId} items={pending} onOpen={setOpen} />}
            </Card>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-b border-surface-border p-3 sm:px-4">
          <Button variant="secondary" size="sm" onClick={() => set({ date: undefined })}>
            {tr('היום')}
          </Button>
          <div className="flex">
            <button
              type="button"
              aria-label={view === 'day' ? tr('היום הקודם') : tr('השבוע הקודם')}
              onClick={() => shift(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken"
            >
              <ChevronRight aria-hidden className="h-4 w-4 ltr:rotate-180" />
            </button>
            <button
              type="button"
              aria-label={view === 'day' ? tr('היום הבא') : tr('השבוע הבא')}
              onClick={() => shift(1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken"
            >
              <ChevronLeft aria-hidden className="h-4 w-4 ltr:rotate-180" />
            </button>
          </div>
          <h2 aria-live="polite" className="text-base font-semibold text-ink">
            {rangeLabel}
          </h2>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {manager && (
              <SelectMenu
                compact
                labelHidden
                label={tr('סינון לפי איש צוות')}
                value={staff}
                onChange={(v) => set({ staff: v || undefined })}
                options={[
                  { value: '', label: tr('כל הצוות') },
                  ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.fullName })),
                ]}
              />
            )}
            <div
              role="group"
              aria-label={tr('תצוגה')}
              className="flex rounded-lg bg-surface-sunken p-0.5"
            >
              {(['day', 'week'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => set({ view: v === 'week' ? undefined : 'day' })}
                  className={cn(
                    'rounded-md px-3 py-1 text-sm',
                    view === v ? 'bg-surface text-ink shadow-card' : 'text-ink-muted',
                  )}
                >
                  {v === 'day' ? tr('יום') : tr('שבוע')}
                </button>
              ))}
            </div>
          </div>
        </div>

        {list.isPending ? (
          <div className="p-4">
            <Spinner label={tr('טוענים את היומן…')} />
          </div>
        ) : list.isError ? (
          <div className="p-4">
            <Alert tone="danger">{errorMessage(list.error)}</Alert>
          </div>
        ) : (
          <div className="flex flex-col">
            <TimeGrid
              days={days}
              appointments={list.data ?? []}
              openingHours={business.openingHours}
              capacity={capacity}
              onPick={(day, time) => setSlot({ day, time })}
              onOpen={setOpen}
            />
            <div className="border-t border-surface-border px-4 py-3">
              <TimeGridLegend />
            </div>
          </div>
        )}
      </section>

      {list.data?.length === 0 && pending.length === 0 && (
        <EmptyState
          icon={CalendarDays}
          tone="bg-rose-500"
          title={tr('אין פגישות בתקופה הזו')}
          description={
            manager
              ? tr('כדאי להתחיל בהגדרת השירותים שלכם (בכפתור "עוד"), ואז לקבוע פגישה ראשונה.')
              : tr('כשייקבעו לך פגישות, הן יופיעו כאן.')
          }
        />
      )}

      <NewAppointmentDialog
        open={newOpen || slot !== null}
        onOpenChange={(o) => {
          setNewOpen(o);
          if (!o) setSlot(null);
        }}
        // A picked free slot, else today when it's in view, else the first day shown.
        day={slot?.day ?? days.find((d) => sameDay(d, today)) ?? from}
        time={slot?.time}
        staffId={slot ? staff || undefined : undefined}
      />
      <AppointmentDialog appointment={open} onOpenChange={(o) => !o && setOpen(null)} />
    </>
  );
}
