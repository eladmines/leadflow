import { can, type Lead } from '@leadflow/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, DialogShell, Field, Select, Textarea } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';
import { ApiError } from '../../lib/api';
import { useMembers } from '../businesses/api';
import { useLeads } from '../leads/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { fromInputs, toDateInput, useCreateAppointment, useServices } from './api';

/** Book an appointment for an existing lead or a new customer (name + phone). */
export function NewAppointmentDialog({
  open,
  onOpenChange,
  day,
  lead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected day (the calendar's current day). */
  day?: Date;
  /** Booking from a lead's page: the customer is fixed. */
  lead?: Pick<Lead, 'id' | 'contact'>;
}) {
  const business = useCurrentBusiness();
  const manager = can(business.role, 'appointments.view.all');
  const services = useServices(business.id);
  const members = useMembers(business.id, manager);
  const create = useCreateAppointment(business.id);

  const [mode, setMode] = useState<'lead' | 'new'>(lead ? 'lead' : 'new');
  const [leadQuery, setLeadQuery] = useState('');
  const [leadId, setLeadId] = useState(lead?.id ?? '');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [date, setDate] = useState(toDateInput(day ?? new Date()));
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState('30');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const found = useLeads(business.id, { q: leadQuery.trim() || undefined });

  useEffect(() => {
    if (!open) return;
    setErrors({});
    create.reset();
    setDate(toDateInput(day ?? new Date()));
    setLeadId(lead?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const activeServices = (services.data ?? []).filter((s) => s.active);
  const pickService = (id: string) => {
    setServiceId(id);
    const s = activeServices.find((x) => x.id === id);
    if (s) setDuration(String(s.durationMin));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    try {
      await create.mutateAsync({
        startsAt: fromInputs(date, time),
        durationMin: Number(duration) || undefined,
        serviceId: serviceId || undefined,
        ...(manager && staffId ? { staffId } : {}),
        ...(mode === 'lead' ? { leadId } : { customer: { name, phone } }),
        notes,
      });
      onOpenChange(false);
      setName('');
      setPhone('');
      setNotes('');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
    }
  };

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title="תור חדש">
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        {create.isError && !(create.error instanceof ApiError && create.error.fields) && (
          <Alert tone="danger">{errorMessage(create.error)}</Alert>
        )}

        {lead ? (
          <p className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-ink">
            לקוח: <strong>{lead.contact.name}</strong>
          </p>
        ) : (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium text-ink">לקוח</legend>
            <div role="radiogroup" className="flex gap-2">
              {(['new', 'lead'] as const).map((m) => (
                <label
                  key={m}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-surface-border px-3 py-1.5 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50"
                >
                  <input
                    type="radio"
                    name="customer-mode"
                    checked={mode === m}
                    onChange={() => setMode(m)}
                    className="accent-brand-600"
                  />
                  {m === 'new' ? 'לקוח חדש' : 'ליד קיים'}
                </label>
              ))}
            </div>
            {mode === 'new' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="שם הלקוח"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  error={errors['customer.name']}
                />
                <Field
                  label="טלפון"
                  ltr
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  error={errors['customer.phone']}
                />
              </div>
            ) : (
              <>
                <Field
                  label="חיפוש ליד"
                  placeholder="שם, טלפון או אימייל"
                  value={leadQuery}
                  onChange={(e) => setLeadQuery(e.target.value)}
                />
                <Select
                  label="ליד"
                  placeholder="בחירת ליד"
                  options={(found.data ?? [])
                    .slice(0, 30)
                    .map((l) => ({ value: l.id, label: l.contact.name }))}
                  value={leadId}
                  onChange={(e) => setLeadId(e.target.value)}
                  error={errors.leadId}
                />
              </>
            )}
          </fieldset>
        )}

        <Select
          label="שירות"
          placeholder={activeServices.length ? 'בחירת שירות (לא חובה)' : 'אין עדיין שירותים'}
          options={activeServices.map((s) => ({
            value: s.id,
            label: `${s.name} · ${s.durationMin} דק׳`,
          }))}
          value={serviceId}
          onChange={(e) => pickService(e.target.value)}
          error={errors.serviceId}
        />
        {manager && (
          <Select
            label="איש צוות"
            options={[
              { value: '', label: 'אני' },
              ...(members.data ?? [])
                .filter((m) => m.userId !== undefined)
                .map((m) => ({ value: m.userId, label: m.fullName })),
            ]}
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            error={errors.staffId}
          />
        )}
        <div className="grid grid-cols-3 gap-3">
          <Field label="תאריך" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Field label="שעה" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <Field
            label="משך (דק׳)"
            inputMode="numeric"
            ltr
            value={duration}
            onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))}
            error={errors.durationMin}
          />
        </div>
        <Textarea
          label="הערות"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          error={errors.notes}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            ביטול
          </Button>
          <Button type="submit" loading={create.isPending}>
            קביעת התור
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
