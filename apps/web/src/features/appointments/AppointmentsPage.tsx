import {
  appointmentStatusLabels,
  can,
  type Appointment,
  type AppointmentStatus,
} from '@leadflow/shared';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Spinner } from '../../components/ui';
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

/** Status tone + text (colour is never the only signal). */
export const statusTone: Record<AppointmentStatus, string> = {
  REQUESTED: 'border-warning-600/40 bg-warning-50 text-warning-600',
  CONFIRMED: 'border-brand-200 bg-brand-50 text-brand-800',
  COMPLETED: 'border-success-600/30 bg-success-50 text-success-600',
  NO_SHOW: 'border-surface-border bg-surface-sunken text-ink-muted',
  CANCELLED: 'border-surface-border bg-surface text-ink-subtle line-through',
};

function AppointmentChip({ a, onOpen }: { a: Appointment; onOpen: (a: Appointment) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(a)}
      className={cn(
        'flex w-full flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-start text-xs transition-shadow hover:shadow-card',
        statusTone[a.status],
      )}
    >
      <bdi dir="ltr" className="font-semibold tabular-nums">
        {timeFmt.format(new Date(a.startsAt))}–{timeFmt.format(new Date(a.endsAt))}
      </bdi>
      <span className="truncate text-sm font-medium text-ink">{a.customer.name}</span>
      <span className="truncate text-ink-muted">
        {[a.service?.name, a.staff?.name].filter(Boolean).join(' · ')}
      </span>
      {a.status !== 'CONFIRMED' && (
        <span className="font-medium">{appointmentStatusLabels[a.status]}</span>
      )}
    </button>
  );
}

/** F17: day/week calendar, pending website requests, and services (owners/managers). */
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
  const [servicesOpen, setServicesOpen] = useState(false);

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

  const byDay = useMemo(
    () =>
      days.map((d) => ({
        day: d,
        items: (list.data ?? []).filter((a) => sameDay(new Date(a.startsAt), d)),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list.data, from.getTime(), days.length],
  );
  const pending = (requests.data ?? []).filter((r) => r.status === 'REQUESTED');
  const today = new Date();
  const rangeLabel =
    view === 'day'
      ? dayFmt.format(from)
      : `${shortDayFmt.format(from)} – ${shortDayFmt.format(addDays(to, -1))}`;

  return (
    <>
      <PageHeader
        title="תורים"
        description="היומן של העסק: תורים, בקשות מהאתר ושירותים."
        actions={
          <div className="flex flex-wrap gap-2">
            {manager && (
              <Button
                variant="secondary"
                aria-expanded={servicesOpen}
                onClick={() => setServicesOpen((o) => !o)}
              >
                <Settings2 aria-hidden className="h-4 w-4" />
                שירותים
              </Button>
            )}
            <Button onClick={() => setNewOpen(true)}>
              <Plus aria-hidden className="h-4 w-4" />
              תור חדש
            </Button>
          </div>
        }
      />
      {servicesOpen && <ServicesPanel />}

      {pending.length > 0 && (
        <Card className="flex flex-col gap-3 border-warning-600/30 bg-warning-50/60">
          <h2 className="text-sm font-semibold text-ink">
            בקשות ממתינות לאישור ({pending.length})
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {pending.map((r) => (
              <li key={r.id}>
                <AppointmentChip a={r} onOpen={setOpen} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => set({ date: undefined })}>
          היום
        </Button>
        <div className="flex">
          <button
            type="button"
            aria-label={view === 'day' ? 'היום הקודם' : 'השבוע הקודם'}
            onClick={() => shift(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken"
          >
            <ChevronRight aria-hidden className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={view === 'day' ? 'היום הבא' : 'השבוע הבא'}
            onClick={() => shift(1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken"
          >
            <ChevronLeft aria-hidden className="h-4 w-4" />
          </button>
        </div>
        <h2 aria-live="polite" className="text-base font-semibold text-ink">
          {rangeLabel}
        </h2>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {manager && (
            <select
              aria-label="סינון לפי איש צוות"
              value={staff}
              onChange={(e) => set({ staff: e.target.value || undefined })}
              className="h-8 rounded-lg border border-surface-border bg-surface px-2 text-sm text-ink"
            >
              <option value="">כל הצוות</option>
              {(members.data ?? []).map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.fullName}
                </option>
              ))}
            </select>
          )}
          <div role="group" aria-label="תצוגה" className="flex rounded-lg bg-surface-sunken p-0.5">
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
                {v === 'day' ? 'יום' : 'שבוע'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {list.isPending ? (
        <Spinner label="טוענים את היומן…" />
      ) : list.isError ? (
        <Alert tone="danger">{errorMessage(list.error)}</Alert>
      ) : (
        <div
          className={cn(
            'grid gap-3',
            view === 'week' ? 'sm:grid-cols-2 lg:grid-cols-7 lg:gap-2' : 'max-w-xl',
          )}
        >
          {byDay.map(({ day, items }) => (
            <section
              key={day.toISOString()}
              aria-label={dayFmt.format(day)}
              className={cn(
                'flex flex-col gap-2 rounded-xl border p-2 lg:min-h-28',
                sameDay(day, today)
                  ? 'border-brand-300 bg-brand-50/40'
                  : 'border-surface-border bg-surface-muted/50',
              )}
            >
              <header className="flex items-center justify-between px-1">
                <button
                  type="button"
                  onClick={() => set({ view: 'day', date: toDateInput(day) })}
                  className="text-xs font-semibold text-ink hover:underline"
                >
                  {shortDayFmt.format(day)}
                </button>
                {items.length > 0 && (
                  <span className="text-[11px] text-ink-muted">{items.length}</span>
                )}
              </header>
              {items.length === 0 ? (
                <p className="px-1 text-xs text-ink-subtle">אין תורים</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {items.map((a) => (
                    <li key={a.id}>
                      <AppointmentChip a={a} onOpen={setOpen} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {list.data?.length === 0 && pending.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <CalendarDays aria-hidden className="h-4 w-4" />
          {manager
            ? 'אין תורים בתקופה הזו. כדאי להתחיל בהגדרת השירותים שלכם, ואז לקבוע תור ראשון.'
            : 'אין לך תורים בתקופה הזו.'}
        </p>
      )}

      <NewAppointmentDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        // Today when it's in view, otherwise the first day shown.
        day={days.find((d) => sameDay(d, today)) ?? from}
      />
      <AppointmentDialog appointment={open} onOpenChange={(o) => !o && setOpen(null)} />
    </>
  );
}
