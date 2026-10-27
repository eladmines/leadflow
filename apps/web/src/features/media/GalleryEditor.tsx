import { SITE_LIMITS, type Section } from '@leadflow/shared';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Field } from '../../components/ui';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { useAssets } from './api';
import { MediaPicker } from './MediaPicker';

type Items = Extract<Section, { type: 'gallery' }>['items'];
const iconBtn =
  'flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-30';

/** Gallery images with captions (used as alt text). */
export function GalleryEditor({
  items,
  onChange,
}: {
  items: Items;
  onChange: (items: Items) => void;
}) {
  const business = useCurrentBusiness();
  const assets = useAssets(business.id);
  const [open, setOpen] = useState(false);
  const url = (id: string) => assets.data?.assets.find((a) => a.id === id)?.url;
  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && (
        <p className="text-sm text-ink-muted">
          עדיין אין תמונות בגלריה. הגלריה תוצג באתר רק כשיהיו בה תמונות.
        </p>
      )}
      <ol aria-label="תמונות בגלריה" className="flex flex-col gap-3">
        {items.map((item, i) => (
          <li
            key={`${item.assetId}-${i}`}
            className="flex gap-3 rounded-2xl border border-surface-border bg-surface-muted/60 p-3"
          >
            <div className="h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-sunken">
              {url(item.assetId) && (
                <img src={url(item.assetId)} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Field
                label={`כיתוב לתמונה ${i + 1}`}
                hint="מוצג מתחת לתמונה ומשמש כטקסט חלופי לנגישות"
                maxLength={160}
                value={item.caption}
                onChange={(e) =>
                  onChange(
                    items.map((it, j) => (j === i ? { ...it, caption: e.target.value } : it)),
                  )
                }
              />
              <div className="flex">
                <button
                  type="button"
                  className={iconBtn}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={`הזזת תמונה ${i + 1} למעלה`}
                >
                  <ArrowUp aria-hidden className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={iconBtn}
                  disabled={i === items.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`הזזת תמונה ${i + 1} למטה`}
                >
                  <ArrowDown aria-hidden className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={iconBtn}
                  onClick={() => onChange(items.filter((_, j) => j !== i))}
                  aria-label={`הסרת תמונה ${i + 1} מהגלריה`}
                >
                  <Trash2 aria-hidden className="h-4 w-4" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {items.length < SITE_LIMITS.items && (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setOpen(true)}>
          <Plus aria-hidden className="h-4 w-4" />
          הוספת תמונה
        </Button>
      )}
      <MediaPicker
        open={open}
        onOpenChange={setOpen}
        title="הוספת תמונה לגלריה"
        onSelect={(a) => onChange([...items, { assetId: a.id, caption: '' }])}
      />
    </div>
  );
}
