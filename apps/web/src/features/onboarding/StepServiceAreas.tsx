import {
  SERVICE_AREA_MAX_LENGTH,
  SERVICE_AREAS_MAX,
  businessMessages,
  type Business,
} from '@leadflow/shared';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Alert, Button, Field } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';

interface Props {
  business: Business;
  onSubmit: (serviceAreas: string[]) => Promise<void>;
  onSkip: () => Promise<void>;
  onBack: () => void;
}

/** Step 3: optional list of service areas (cities/regions), entered as removable chips. */
export function StepServiceAreas({ business, onSubmit, onSkip, onBack }: Props) {
  const [areas, setAreas] = useState<string[]>(business.serviceAreas);
  const [draft, setDraft] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<'save' | 'skip' | null>(null);
  const listId = useId();

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (value.length > SERVICE_AREA_MAX_LENGTH)
      return setFieldError(businessMessages.serviceAreaTooLong);
    if (areas.length >= SERVICE_AREAS_MAX)
      return setFieldError(businessMessages.serviceAreasTooMany);
    if (!areas.some((a) => a.toLowerCase() === value.toLowerCase())) setAreas([...areas, value]);
    setDraft('');
    setFieldError(undefined);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    }
  };

  const run = async (kind: 'save' | 'skip', action: () => Promise<void>) => {
    setFormError(null);
    setPending(kind);
    try {
      await action();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // Include a typed-but-not-added value, so nothing the user typed is lost.
    const pendingValue = draft.trim();
    const final =
      pendingValue && !areas.some((a) => a.toLowerCase() === pendingValue.toLowerCase())
        ? [...areas, pendingValue]
        : areas;
    void run('save', () => onSubmit(final));
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-ink">באילו אזורים אתם נותנים שירות?</h1>
        <p className="text-sm text-ink-muted">
          ערים או אזורים, למשל &quot;חיפה&quot; או &quot;השרון&quot;. אפשר לדלג ולהוסיף בהמשך.
        </p>
      </header>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field
            label="הוספת אזור שירות"
            placeholder="הקלידו שם עיר ולחצו Enter"
            value={draft}
            error={fieldError}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <Button variant="secondary" onClick={add} className={fieldError ? 'mb-6' : undefined}>
          הוספה
        </Button>
      </div>

      {areas.length > 0 && (
        <ul id={listId} aria-label="אזורי השירות שנבחרו" className="flex flex-wrap gap-2">
          {areas.map((area) => (
            <li
              key={area}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pe-1 ps-3 text-sm text-brand-800"
            >
              {area}
              <button
                type="button"
                onClick={() => setAreas(areas.filter((a) => a !== area))}
                aria-label={`הסרת ${area}`}
                className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-brand-100"
              >
                <span aria-hidden>×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap justify-between gap-3">
        <Button variant="ghost" onClick={onBack} disabled={pending !== null}>
          חזרה
        </Button>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            loading={pending === 'skip'}
            disabled={pending !== null}
            onClick={() => void run('skip', onSkip)}
          >
            דילוג
          </Button>
          <Button type="submit" loading={pending === 'save'} disabled={pending !== null}>
            המשך
          </Button>
        </div>
      </div>
    </form>
  );
}
