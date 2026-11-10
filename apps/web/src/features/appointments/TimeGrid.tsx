import {
  appointmentStatusLabels,
  WEEKDAYS,
  type Appointment,
  type OpeningHours,
} from '@leadflow/shared';
import { Plus } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '../../lib/cn';
import { tr } from '../../i18n';
import { dayFmt, sameDay, shortDayFmt, timeFmt, toTimeInput } from './api';

/**
 * Calendar grid (D-101): days across, half-hours down, sized to the opening hours. Appointments
 * are blocks at their real time and length; free slots (open, in the future, not fully booked)
 * can be clicked to book; closed and past times are shaded. Colour is never the only signal:
 * blocks carry their status in text and slots their state in the label.
 */

const SLOT_MIN = 30;
const ROW_PX = 44;
const FALLBACK = { from: 8 * 60, to: 20 * 60 };

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const minutesIntoDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
const at = (day: Date, minutes: number) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes);

/** Appointments that take a place in the calendar (cancelled ones free their slot). */
const occupies = (a: Appointment) => a.status !== 'CANCELLED';

/** Side-by-side lanes for overlapping appointments in one day. */
function lanes(items: Appointment[]) {
  const sorted = [...items].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const out = new Map<string, { lane: number; of: number }>();
  let cluster: { a: Appointment; lane: number }[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const of = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) out.set(c.a.id, { lane: c.lane, of });
    cluster = [];
  };
  for (const a of sorted) {
    const start = new Date(a.startsAt).getTime();
    const end = new Date(a.endsAt).getTime();
    if (cluster.length && start >= clusterEnd) flush();
    const taken = new Set(
      cluster.filter((c) => new Date(c.a.endsAt).getTime() > start).map((c) => c.lane),
    );
    let lane = 0;
    while (taken.has(lane)) lane += 1;
    cluster.push({ a, lane });
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (cluster.length) flush();
  return out;
}

const statusBlock: Record<Appointment['status'], string> = {
  REQUESTED: 'border-warning-600/50 bg-warning-50 text-warning-600',
  CONFIRMED: 'border-brand-300 bg-brand-50 text-brand-800',
  COMPLETED: 'border-success-600/40 bg-success-50 text-success-600',
  NO_SHOW: 'border-surface-border bg-surface-sunken text-ink-muted',
  CANCELLED: 'border-surface-border bg-surface text-ink-subtle line-through opacity-70',
};

export function TimeGrid({
  days,
  appointments,
  openingHours,
  capacity,
  onPick,
  onOpen,
  now = new Date(),
}: {
  days: Date[];
  appointments: Appointment[];
  openingHours: OpeningHours | null;
  /** How many appointments fit in one slot: 1 for a staff member, the team size for "all". */
  capacity: number;
  onPick: (day: Date, time: string) => void;
  onOpen: (a: Appointment) => void;
  now?: Date;
}) {
  const hoursOf = (day: Date) => {
    if (!openingHours) return FALLBACK;
    const h = openingHours[WEEKDAYS[day.getDay()]!];
    return h?.open ? { from: toMin(h.from), to: toMin(h.to) } : null;
  };

  // Rows: from the earliest opening to the latest closing in view, widened for bookings outside.
  const range = useMemo(() => {
    const open = days.map(hoursOf).filter((h): h is { from: number; to: number } => Boolean(h));
    let from = open.length ? Math.min(...open.map((h) => h.from)) : FALLBACK.from;
    let to = open.length ? Math.max(...open.map((h) => h.to)) : FALLBACK.to;
    for (const a of appointments) {
      const s = new Date(a.startsAt);
      if (!days.some((d) => sameDay(d, s))) continue;
      from = Math.min(from, minutesIntoDay(s));
      to = Math.max(to, minutesIntoDay(new Date(a.endsAt)));
    }
    from = Math.floor(from / SLOT_MIN) * SLOT_MIN;
    to = Math.ceil(to / SLOT_MIN) * SLOT_MIN;
    return { from, to: Math.max(to, from + SLOT_MIN) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.map((d) => d.getTime()).join(), appointments, openingHours]);

  const slots = Array.from(
    { length: (range.to - range.from) / SLOT_MIN },
    (_, i) => range.from + i * SLOT_MIN,
  );
  const pxPerMin = ROW_PX / SLOT_MIN;
  const week = days.length > 1;

  return (
    <div className="scrollbar-visible overflow-x-auto bg-surface">
      <div
        role="grid"
        aria-label={tr('לוח זמנים')}
        className={cn('grid', week ? 'min-w-[760px]' : 'min-w-[320px]')}
        style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {/* Header row */}
        <div className="sticky top-0 z-20 border-b border-surface-border bg-surface" />
        {days.map((day) => {
          const closed = !hoursOf(day);
          const today = sameDay(day, now);
          return (
            <div
              key={`h-${day.getTime()}`}
              role="columnheader"
              className={cn(
                'sticky top-0 z-20 flex flex-col items-center gap-0.5 border-b border-s border-surface-border bg-surface px-1 py-2 text-xs',
                today && 'bg-brand-50',
              )}
            >
              <span className={cn('font-semibold', today ? 'text-brand-700' : 'text-ink')}>
                {(week ? shortDayFmt : dayFmt).format(day)}
              </span>
              {closed && <span className="text-[11px] text-ink-subtle">{tr('סגור')}</span>}
            </div>
          );
        })}

        {/* Time labels */}
        <div className="relative" style={{ height: slots.length * ROW_PX }}>
          {slots.map((m, i) =>
            m % 60 === 0 ? (
              <span
                key={m}
                // The first label sits below the line so the sticky day header doesn't cover it.
                className={cn(
                  'absolute end-2 text-[11px] tabular-nums text-ink-subtle',
                  i === 0 ? 'translate-y-0.5' : '-translate-y-1/2',
                )}
                style={{ top: i * ROW_PX }}
              >
                <bdi dir="ltr">{timeFmt.format(at(days[0]!, m))}</bdi>
              </span>
            ) : null,
          )}
        </div>

        {/* Day columns */}
        {days.map((day) => {
          const hours = hoursOf(day);
          const dayItems = appointments.filter((a) => sameDay(new Date(a.startsAt), day));
          const laneOf = lanes(dayItems);
          const busy = dayItems.filter(occupies);
          const showNow =
            sameDay(day, now) &&
            minutesIntoDay(now) >= range.from &&
            minutesIntoDay(now) <= range.to;
          return (
            <div
              key={`c-${day.getTime()}`}
              role="gridcell"
              aria-label={dayFmt.format(day)}
              className="relative border-s border-surface-border"
              style={{ height: slots.length * ROW_PX }}
            >
              {slots.map((m, i) => {
                const start = at(day, m);
                const end = at(day, m + SLOT_MIN);
                const inHours = hours ? m >= hours.from && m + SLOT_MIN <= hours.to : false;
                const past = end <= now;
                const taken = busy.filter(
                  (a) => new Date(a.startsAt) < end && new Date(a.endsAt) > start,
                ).length;
                const free = inHours && !past && taken < capacity;
                const time = toTimeInput(start);
                const label = `${dayFmt.format(day)} ${timeFmt.format(start)}`;
                const base = cn(
                  'absolute inset-x-0 border-t',
                  m % 60 === 0 ? 'border-surface-border' : 'border-dashed border-surface-border/60',
                );
                const style = { top: i * ROW_PX, height: ROW_PX };
                return free ? (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onPick(day, time)}
                    aria-label={tr('פנוי: קביעת תור ב{0}', label)}
                    className={cn(
                      base,
                      'group flex items-center justify-center bg-success-50/40 hover:bg-success-50 focus-visible:z-30 focus-visible:bg-success-50',
                    )}
                    style={style}
                  >
                    <span className="flex items-center gap-1 text-[11px] font-medium text-success-600 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
                      <Plus aria-hidden className="h-3 w-3" />
                      {tr('פנוי')}
                    </span>
                  </button>
                ) : (
                  <div
                    key={m}
                    aria-hidden
                    className={cn(
                      base,
                      !inHours
                        ? 'bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,rgb(0_0_0/0.035)_6px,rgb(0_0_0/0.035)_12px)]'
                        : past
                          ? 'bg-surface-muted/70'
                          : '',
                    )}
                    style={style}
                  />
                );
              })}

              {dayItems.map((a) => {
                const s = new Date(a.startsAt);
                const e = new Date(a.endsAt);
                const top = (minutesIntoDay(s) - range.from) * pxPerMin;
                const height = Math.max(22, ((e.getTime() - s.getTime()) / 60_000) * pxPerMin - 2);
                const { lane, of } = laneOf.get(a.id) ?? { lane: 0, of: 1 };
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => onOpen(a)}
                    className={cn(
                      'absolute z-10 flex flex-col overflow-hidden rounded-md border px-1.5 py-1 text-start text-[11px] leading-tight shadow-sm hover:z-20 hover:shadow-card focus-visible:z-20',
                      statusBlock[a.status],
                    )}
                    style={{
                      top: top + 1,
                      height,
                      insetInlineStart: `calc(${(lane / of) * 100}% + 2px)`,
                      width: `calc(${100 / of}% - 4px)`,
                    }}
                  >
                    <bdi dir="ltr" className="font-semibold tabular-nums">
                      {timeFmt.format(s)}–{timeFmt.format(e)}
                    </bdi>
                    <span className="truncate font-medium text-ink">{a.customer.name}</span>
                    {height > 44 && (
                      <span className="truncate text-ink-muted">
                        {[a.service?.name, a.staff?.name].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    {a.status !== 'CONFIRMED' && (
                      <span className="truncate font-medium">
                        {tr(appointmentStatusLabels[a.status])}
                      </span>
                    )}
                  </button>
                );
              })}

              {showNow && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-danger-600"
                  style={{ top: (minutesIntoDay(now) - range.from) * pxPerMin }}
                >
                  <span className="absolute -start-1 -top-1 h-2 w-2 rounded-full bg-danger-600" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** What the colours and patterns mean (text, so colour is never the only signal). */
export function TimeGridLegend() {
  return (
    <ul
      aria-label={tr('מקרא')}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted"
    >
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-3 w-3 rounded-sm border border-success-600/30 bg-success-50"
        />
        {tr('פנוי — לחצו לקביעת תור')}
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-3 rounded-sm border border-brand-300 bg-brand-50" />
        {tr('תור')}
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-3 w-3 rounded-sm border border-warning-600/50 bg-warning-50"
        />
        {tr('ממתין לאישור')}
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-3 w-3 rounded-sm border border-surface-border bg-[repeating-linear-gradient(135deg,transparent,transparent_2px,rgb(0_0_0/0.12)_2px,rgb(0_0_0/0.12)_4px)]"
        />
        {tr('מחוץ לשעות הפעילות')}
      </li>
    </ul>
  );
}
