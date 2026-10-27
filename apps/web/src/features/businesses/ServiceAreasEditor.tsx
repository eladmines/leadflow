import { SERVICE_AREA_MAX_LENGTH, SERVICE_AREAS_MAX, businessMessages } from '@leadflow/shared';
import { useState, type KeyboardEvent } from 'react';
import { Button, Field } from '../../components/ui';

interface Props {
  value: string[];
  onChange: (areas: string[]) => void;
}

/**
 * Service areas as removable chips. Enter, comma or leaving the field adds the typed value,
 * so nothing the user typed is lost when they move on.
 */
export function ServiceAreasEditor({ value, onChange }: Props) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>();

  const add = () => {
    const area = draft.trim();
    if (!area) return;
    if (area.length > SERVICE_AREA_MAX_LENGTH) return setError(businessMessages.serviceAreaTooLong);
    if (value.length >= SERVICE_AREAS_MAX) return setError(businessMessages.serviceAreasTooMany);
    if (!value.some((a) => a.toLowerCase() === area.toLowerCase())) onChange([...value, area]);
    setDraft('');
    setError(undefined);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field
            label="הוספת אזור שירות"
            placeholder="הקלידו שם עיר ולחצו Enter"
            value={draft}
            error={error}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={add}
          />
        </div>
        <Button variant="secondary" onClick={add} className={error ? 'mb-6' : undefined}>
          הוספה
        </Button>
      </div>
      {value.length > 0 && (
        <ul aria-label="אזורי השירות שנבחרו" className="flex flex-wrap gap-2">
          {value.map((area) => (
            <li
              key={area}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pe-1 ps-3 text-sm text-brand-800"
            >
              {area}
              <button
                type="button"
                onClick={() => onChange(value.filter((a) => a !== area))}
                aria-label={`הסרת ${area}`}
                className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-brand-100"
              >
                <span aria-hidden>×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
