import {
  appointmentStatusLabels,
  businessWebPaths,
  can,
  formatIsraeliPhone,
  type Appointment,
  type AppointmentStatus,
} from '@leadflow/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, DialogShell, Field, Select, Textarea } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';
import { useMembers } from '../businesses/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import {
  dayFmt,
  fromInputs,
  minutesOf,
  timeFmt,
  toDateInput,
  toTimeInput,
  useUpdateAppointment,
} from './api';

/** Status actions offered for each status. */
const actions: Partial<Record<AppointmentStatus, { to: AppointmentStatus; label: string }[]>> = {
  REQUESTED: [
    { to: 'CONFIRMED', label: 'אישור התור' },
    { to: 'CANCELLED', label: 'דחייה' },
  ],
  CONFIRMED: [
    { to: 'COMPLETED', label: 'סימון כבוצע' },
    { to: 'NO_SHOW', label: 'לא הגיע/ה' },
    { to: 'CANCELLED', label: 'ביטול התור' },
  ],
  CANCELLED: [{ to: 'CONFIRMED', label: 'החזרה לתור מאושר' }],
  NO_SHOW: [{ to: 'COMPLETED', label: 'סימון כבוצע' }],
};

export function AppointmentDialog({
  appointment: a,
  onOpenChange,
}: {
  appointment: Appointment | null;
  onOpenChange: (open: boolean) => void;
}) {
  const business = useCurrentBusiness();
  const manager = can(business.role, 'appointments.view.all');
  const members = useMembers(business.id, manager);
  const update = useUpdateAppointment(business.id);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('');
  const [staffId, setStaffId] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!a) return;
    const start = new Date(a.startsAt);
    setDate(toDateInput(start));
    setTime(toTimeInput(start));
    setDuration(String(minutesOf(a)));
    setStaffId(a.staff?.id ?? '');
    setNotes(a.notes ?? '');
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a?.id]);

  if (!a) return null;
  const start = new Date(a.startsAt);
  const changed =
    toDateInput(start) !== date ||
    toTimeInput(start) !== time ||
    String(minutesOf(a)) !== duration ||
    (a.staff?.id ?? '') !== staffId ||
    (a.notes ?? '') !== notes;

  const run = async (body: Parameters<typeof update.mutateAsync>[0]) => {
    try {
      await update.mutateAsync(body);
      onOpenChange(false);
    } catch {
      /* shown below */
    }
  };

  return (
    <DialogShell open onOpenChange={onOpenChange} title={a.customer.name}>
      <div className="flex flex-col gap-1 text-sm text-ink-muted">
        <p>
          {dayFmt.format(start)} ·{' '}
          <bdi dir="ltr">
            {timeFmt.format(start)}–{timeFmt.format(new Date(a.endsAt))}
          </bdi>
        </p>
        <p>
          {a.service?.name ?? 'ללא שירות'} · {a.staff?.name ?? 'לא שובץ איש צוות'} ·{' '}
          <span className="font-medium text-ink">{appointmentStatusLabels[a.status]}</span>
          {a.source === 'website' && ' · בקשה מהאתר'}
        </p>
        <p className="flex flex-wrap gap-3">
          {a.customer.phone && (
            <a href={`tel:${a.customer.phone}`} className="text-brand-700 hover:underline">
              <bdi dir="ltr">{formatIsraeliPhone(a.customer.phone)}</bdi>
            </a>
          )}
          {a.lead && (
            <Link
              to={`${businessWebPaths.section(business.id, 'leads')}/${a.lead.id}`}
              className="text-brand-700 hover:underline"
            >
              לכרטיס הליד
            </Link>
          )}
        </p>
      </div>

      {update.isError && <Alert tone="danger">{errorMessage(update.error)}</Alert>}

      {actions[a.status] && (
        <div className="flex flex-wrap gap-2">
          {actions[a.status]!.map((x) => (
            <Button
              key={x.to}
              size="sm"
              variant={x.to === 'CANCELLED' || x.to === 'NO_SHOW' ? 'secondary' : 'primary'}
              loading={update.isPending}
              onClick={() =>
                void run({
                  id: a.id,
                  status: x.to,
                  // Confirming a request assigns the chosen staff member at the same time.
                  ...(x.to === 'CONFIRMED' && staffId && staffId !== a.staff?.id
                    ? { staffId }
                    : {}),
                })
              }
            >
              {x.label}
            </Button>
          ))}
        </div>
      )}

      <fieldset className="flex flex-col gap-3 border-t border-surface-border pt-4">
        <legend className="sr-only">שינוי פרטי התור</legend>
        <div className="grid grid-cols-3 gap-3">
          <Field label="תאריך" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Field label="שעה" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <Field
            label="משך (דק׳)"
            ltr
            inputMode="numeric"
            value={duration}
            onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        {manager && (
          <Select
            label="איש צוות"
            placeholder="לא שובץ"
            options={(members.data ?? []).map((m) => ({ value: m.userId, label: m.fullName }))}
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
          />
        )}
        <Textarea label="הערות" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex justify-end">
          <Button
            variant="secondary"
            disabled={!changed}
            loading={update.isPending}
            onClick={() =>
              void run({
                id: a.id,
                startsAt: fromInputs(date, time),
                durationMin: Number(duration) || undefined,
                ...(manager ? { staffId: staffId || null } : {}),
                notes,
              })
            }
          >
            שמירת השינויים
          </Button>
        </div>
      </fieldset>
    </DialogShell>
  );
}
