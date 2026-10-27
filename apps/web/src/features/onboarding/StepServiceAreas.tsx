import type { Business } from '@leadflow/shared';
import { useState, type FormEvent } from 'react';
import { Alert, Button } from '../../components/ui';
import { errorMessage } from '../auth/serverErrors';
import { ServiceAreasEditor } from '../businesses/ServiceAreasEditor';

interface Props {
  business: Business;
  onSubmit: (serviceAreas: string[]) => Promise<void>;
  onSkip: () => Promise<void>;
  onBack: () => void;
}

/** Step 3: optional list of service areas (cities/regions). */
export function StepServiceAreas({ business, onSubmit, onSkip, onBack }: Props) {
  const [areas, setAreas] = useState<string[]>(business.serviceAreas);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState<'save' | 'skip' | null>(null);

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
    void run('save', () => onSubmit(areas));
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
      <ServiceAreasEditor value={areas} onChange={setAreas} />
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
