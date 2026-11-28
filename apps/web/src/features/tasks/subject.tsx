import {
  appointmentStatusLabels,
  businessWebPaths,
  quoteStatusLabels,
  type TaskAutoKind,
  type TaskSubject,
} from '@simplecatch/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SelectMenu } from '../../components/ui';
import { cn } from '../../lib/cn';
import { intlLocale, tr } from '../../i18n';
import { toDateInput, useAppointments } from '../appointments/api';
import { useQuotes } from '../quotes/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';

/** F35 (D-213): what a task is about — one quote or one appointment, chosen by kind and id. */
export type SubjectRef = { kind: 'quote' | 'appointment'; id: string };

/** The request fields for a subject (or for none: both cleared). */
export const subjectBody = (s: SubjectRef | null) => ({
  quoteId: s?.kind === 'quote' ? s.id : null,
  appointmentId: s?.kind === 'appointment' ? s.id : null,
});

const encode = (s: SubjectRef | null) => (s ? `${s.kind}:${s.id}` : '');
const decode = (v: string): SubjectRef | null => {
  const [kind, id] = v.split(':');
  return (kind === 'quote' || kind === 'appointment') && id ? { kind, id } : null;
};

/**
 * "12/02 10:00" in the business's time zone: day and month as the app's language orders them
 * (he-IL / en-GB both day first), one short form for both.
 */
export function appointmentWhen(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat(intlLocale(), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${part('day')}/${part('month')} ${part('hour')}:${part('minute')}`;
}

/** The visible label, e.g. "הצעה #12" / "פגישה 12/02 10:00", and its status in words. */
export function subjectText(subject: TaskSubject, timeZone: string) {
  return subject.kind === 'quote'
    ? {
        label: tr('הצעה #{0}', subject.number),
        status: tr(quoteStatusLabels[subject.status]),
        spoken: tr('על הצעה #{0}', subject.number),
      }
    : {
        label: tr('פגישה {0}', appointmentWhen(subject.startsAt, timeZone)),
        status: tr(appointmentStatusLabels[subject.status]),
        spoken: tr('על הפגישה ב־{0}', appointmentWhen(subject.startsAt, timeZone)),
      };
}

/** Where a subject opens: the quote, or the appointments calendar on that day with it open. */
export function subjectHref(businessId: string, subject: TaskSubject) {
  if (subject.kind === 'quote') {
    return `${businessWebPaths.section(businessId, 'quotes')}/${subject.id}`;
  }
  const date = toDateInput(new Date(subject.startsAt));
  return `${businessWebPaths.section(businessId, 'appointments')}?view=day&date=${date}&appointment=${subject.id}`;
}

/** Closed states (a decided quote, a past/cancelled appointment) read quieter. */
const isClosed = (s: TaskSubject) =>
  s.kind === 'quote'
    ? s.status === 'ACCEPTED' || s.status === 'REJECTED'
    : s.status === 'CANCELLED' || s.status === 'COMPLETED' || s.status === 'NO_SHOW';

/** The task's subject as a link chip: "📄 הצעה #12 · נשלחה" / "📅 פגישה 12/02 10:00 · מאושרת". */
export function SubjectChip({ subject }: { subject: TaskSubject }) {
  const business = useCurrentBusiness();
  const { label, status, spoken } = subjectText(subject, business.timezone);
  return (
    <Link
      to={subjectHref(business.id, subject)}
      aria-label={`${spoken}, ${status}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 ring-1 ring-inset hover:underline',
        isClosed(subject)
          ? 'bg-surface-muted text-ink-muted ring-surface-border'
          : 'bg-brand-50 text-brand-800 ring-brand-200',
      )}
    >
      <span aria-hidden>{subject.kind === 'quote' ? '📄' : '📅'}</span>
      <bdi>{label}</bdi>
      <span className="text-ink-muted">· {status}</span>
    </Link>
  );
}

const autoExplanation = (kind: TaskAutoKind) =>
  kind === 'quote_followup'
    ? tr('נוצרה אוטומטית, ותיסגר מעצמה כשההצעה תאושר או תידחה.')
    : tr('נוצרה אוטומטית, ותיסגר מעצמה כשהפגישה תבוטל, תתקיים או תסומן שלא הגיעו.');

/** "אוטומטית" on a task the system created (D-213), with what it means for screen readers too. */
export function AutoBadge({ kind }: { kind: TaskAutoKind }) {
  const explanation = autoExplanation(kind);
  return (
    <span
      title={explanation}
      className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-violet-700 ring-1 ring-inset ring-violet-200"
    >
      {tr('אוטומטית')}
      <span className="sr-only"> — {explanation}</span>
    </span>
  );
}

/**
 * "קשור ל…": one of the lead's quotes or appointments, or nothing (D-213: never both — a single
 * choice). Only offered when the task has a lead.
 */
export function SubjectPicker({
  leadId,
  value,
  onChange,
  error,
}: {
  leadId: string;
  value: SubjectRef | null;
  onChange: (value: SubjectRef | null) => void;
  error?: string;
}) {
  const business = useCurrentBusiness();
  const businessId = business.id;
  const timeZone = business.timezone;
  const quotes = useQuotes(businessId, { leadId });
  // The appointments around now: two months back, four ahead (fixed once per form).
  const [range] = useState(() => {
    const now = Date.now();
    return {
      from: new Date(now - 60 * 86_400_000).toISOString(),
      to: new Date(now + 120 * 86_400_000).toISOString(),
    };
  });
  const appts = useAppointments(businessId, { ...range, leadId });
  const loading = quotes.isPending || appts.isPending;
  const options = [
    { value: '', label: tr('ללא') },
    ...(quotes.data ?? []).map((q) => ({
      value: encode({ kind: 'quote', id: q.id }),
      label: `${tr('הצעה #{0}', q.number)} · ${tr(quoteStatusLabels[q.status])}`,
    })),
    ...(appts.data ?? []).map((a) => ({
      value: encode({ kind: 'appointment', id: a.id }),
      label: `${tr('פגישה {0}', appointmentWhen(a.startsAt, timeZone))} · ${tr(appointmentStatusLabels[a.status])}`,
    })),
  ];
  // A chosen subject not in the lists (e.g. older) stays selectable.
  if (value && !options.some((o) => o.value === encode(value))) {
    options.push({
      value: encode(value),
      label: value.kind === 'quote' ? tr('הצעה מקושרת') : tr('פגישה מקושרת'),
    });
  }
  return (
    <SelectMenu
      label={tr('קשור ל…')}
      value={encode(value)}
      onChange={(v) => onChange(decode(v))}
      options={options}
      disabled={loading}
      placeholder={loading ? tr('טוענים…') : undefined}
      hint={tr('הצעת מחיר או פגישה של הליד (לא חובה)')}
      error={error}
    />
  );
}
