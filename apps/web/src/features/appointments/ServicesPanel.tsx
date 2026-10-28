import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { errorMessage } from '../auth/serverErrors';
import { shekel } from '../leads/api';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { useDeleteService, useSaveService, useServices } from './api';

/** Owners/managers define the services customers book (name, duration, optional price). */
export function ServicesPanel() {
  const business = useCurrentBusiness();
  const services = useServices(business.id);
  const save = useSaveService(business.id);
  const remove = useDeleteService(business.id);
  const [name, setName] = useState('');
  const [duration, setDuration] = useState('30');
  const [price, setPrice] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    try {
      await save.mutateAsync({
        name,
        durationMin: Number(duration),
        price: price ? Number(price) : null,
      });
      setName('');
      setPrice('');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
    }
  };

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-ink">שירותים</h2>
        <p className="text-sm text-ink-muted">מה אפשר לקבוע אצלכם, וכמה זמן זה לוקח.</p>
      </div>
      {(save.isError || remove.isError) &&
        !(save.error instanceof ApiError && save.error.fields) && (
          <Alert tone="danger">{errorMessage(save.error ?? remove.error)}</Alert>
        )}
      {services.data && services.data.length > 0 && (
        <ul aria-label="רשימת שירותים" className="divide-y divide-surface-border">
          {services.data.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5 text-sm">
              <span
                className={s.active ? 'flex-1 text-ink' : 'flex-1 text-ink-subtle line-through'}
              >
                {s.name}
              </span>
              <span className="text-ink-muted">{s.durationMin} דק׳</span>
              {s.price !== null && <span className="text-ink-muted">{shekel.format(s.price)}</span>}
              {s.active ? (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`הסרת ${s.name}`}
                  onClick={() => remove.mutate(s.id)}
                >
                  הסרה
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    save.mutate({
                      id: s.id,
                      name: s.name,
                      durationMin: s.durationMin,
                      price: s.price,
                      active: true,
                    })
                  }
                >
                  החזרה
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        noValidate
        onSubmit={(e) => void add(e)}
        className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]"
      >
        <Field
          label="שירות חדש"
          placeholder="למשל: תספורת"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <Field
          label="משך (דק׳)"
          ltr
          inputMode="numeric"
          value={duration}
          onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))}
          error={errors.durationMin}
        />
        <Field
          label="מחיר (₪)"
          ltr
          inputMode="numeric"
          placeholder="לא חובה"
          value={price}
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))}
          error={errors.price}
        />
        <Button type="submit" loading={save.isPending}>
          הוספה
        </Button>
      </form>
    </Card>
  );
}
