import { ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { useAssets } from './api';
import { MediaPicker } from './MediaPicker';

/** Thumbnail + choose/replace/remove for one image reference (logo, hero, about). */
export function ImageField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string | null;
  onChange: (assetId: string | null) => void;
}) {
  const business = useCurrentBusiness();
  const assets = useAssets(business.id);
  const [open, setOpen] = useState(false);
  const current = value ? assets.data?.assets.find((a) => a.id === value) : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-surface-border bg-surface-muted">
          {current ? (
            <img src={current.url} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon aria-hidden className="h-6 w-6 text-ink-subtle" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setOpen(true)}
            aria-label={`${current ? 'החלפת' : 'בחירת'} ${label}`}
          >
            {current ? 'החלפה' : 'בחירת תמונה'}
          </Button>
          {value && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(null)}
              aria-label={`הסרת ${label}`}
            >
              הסרה
            </Button>
          )}
        </div>
      </div>
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
      <MediaPicker
        open={open}
        onOpenChange={setOpen}
        selectedId={value}
        onSelect={(a) => onChange(a.id)}
        title={label}
      />
    </div>
  );
}
