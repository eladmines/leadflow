import {
  contrastWithWhite,
  darkenForContrast,
  MIN_BRAND_CONTRAST,
  type CustomColors as Colors,
} from '@leadflow/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui';

/**
 * Owner-chosen main and accent colours (D-083). Only a main colour readable under white button
 * text is applied; a lighter one gets a warning and a one-click fix (same hue, darker).
 */
export function CustomColors({
  value,
  onChange,
}: {
  value: Colors;
  onChange: (c: Colors) => void;
}) {
  const [primary, setPrimary] = useState(value.primary);
  const [accent, setAccent] = useState(value.accent);
  useEffect(() => {
    setPrimary(value.primary);
    setAccent(value.accent);
  }, [value.primary, value.accent]);

  const valid = (hex: string) => /^#[0-9a-f]{6}$/i.test(hex);
  const readable = valid(primary) && contrastWithWhite(primary) >= MIN_BRAND_CONTRAST;
  const apply = (next: Colors) => {
    if (
      valid(next.primary) &&
      valid(next.accent) &&
      contrastWithWhite(next.primary) >= MIN_BRAND_CONTRAST
    ) {
      onChange({ primary: next.primary.toLowerCase(), accent: next.accent.toLowerCase() });
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-surface-border p-3">
      {(
        [
          [
            'צבע ראשי (כפתורים וכותרות)',
            primary,
            (v: string) => {
              setPrimary(v);
              apply({ primary: v, accent });
            },
          ],
          [
            'צבע הדגשה (נקודות וקישוטים)',
            accent,
            (v: string) => {
              setAccent(v);
              apply({ primary, accent: v });
            },
          ],
        ] as const
      ).map(([label, v, set]) => (
        <label key={label} className="flex items-center gap-3 text-sm text-ink">
          <input
            type="color"
            aria-label={label}
            value={valid(v) ? v : '#000000'}
            onChange={(e) => set(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded-md border border-surface-border bg-surface p-0.5"
          />
          <span className="flex-1">{label}</span>
          <input
            aria-label={`${label}, קוד`}
            dir="ltr"
            value={v}
            maxLength={7}
            onChange={(e) => set(e.target.value.trim())}
            className="h-8 w-[5.5rem] rounded-md border border-surface-border px-2 text-xs"
          />
        </label>
      ))}
      {!readable && valid(primary) && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg bg-warning-50 p-2.5 text-xs text-warning-600"
        >
          הצבע הראשי בהיר מדי: טקסט לבן על כפתורים לא ייקרא היטב.
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() => {
              const fixed = darkenForContrast(primary);
              setPrimary(fixed);
              apply({ primary: fixed, accent });
            }}
          >
            התאמה לגוון כהה יותר
          </Button>
        </div>
      )}
    </div>
  );
}
