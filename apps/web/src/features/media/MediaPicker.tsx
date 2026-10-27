import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  mediaMessages,
  type Asset,
} from '@leadflow/shared';
import { Check, ImagePlus, Trash2 } from 'lucide-react';
import { useId, useState, type ChangeEvent } from 'react';
import { Alert, DialogShell, Spinner } from '../../components/ui';
import { cn } from '../../lib/cn';
import { errorMessage } from '../auth/serverErrors';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { formatBytes, useAssets, useDeleteAsset, useUploadAsset } from './api';

/**
 * The business's image library: upload (validated in the browser, enforced on the server),
 * pick one, or delete unused ones.
 */
export function MediaPicker({
  open,
  onOpenChange,
  onSelect,
  selectedId,
  title = 'בחירת תמונה',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: Asset) => void;
  selectedId?: string | null;
  title?: string;
}) {
  const business = useCurrentBusiness();
  const assets = useAssets(business.id);
  const upload = useUploadAsset(business.id);
  const remove = useDeleteAsset(business.id);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const inputId = useId();

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type))
      return setError(mediaMessages.wrongType);
    if (file.size > MAX_UPLOAD_BYTES) return setError(mediaMessages.tooLarge);
    try {
      const { asset } = await upload.mutateAsync(file);
      onSelect(asset);
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const data = assets.data;
  const usedPct = data ? Math.min(100, Math.round((data.usedBytes / data.quotaBytes) * 100)) : 0;

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title={title}>
      <div className="flex flex-col gap-4">
        <label
          htmlFor={inputId}
          className={cn(
            'flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/50 px-4 py-6 text-center hover:bg-brand-50',
            upload.isPending && 'pointer-events-none opacity-60',
          )}
        >
          {upload.isPending ? (
            <Spinner label="מעלים ומעבדים את התמונה…" />
          ) : (
            <ImagePlus aria-hidden className="h-7 w-7 text-brand-600" />
          )}
          <span className="text-sm font-medium text-ink">העלאת תמונה מהמחשב או מהטלפון</span>
          <span className="text-xs text-ink-muted">
            JPG, PNG או WebP, עד 8MB. נקטין ונדחוס אוטומטית.
          </span>
          <input
            id={inputId}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            onChange={(e) => void onFile(e)}
            className="sr-only"
          />
        </label>
        {error && <Alert tone="danger">{error}</Alert>}
        {remove.isError && <Alert tone="danger">{errorMessage(remove.error)}</Alert>}

        {assets.isPending ? (
          <Spinner label="טוענים תמונות…" />
        ) : assets.isError ? (
          <Alert tone="danger">{errorMessage(assets.error)}</Alert>
        ) : data!.assets.length === 0 ? (
          <p className="text-center text-sm text-ink-muted">עדיין לא הועלו תמונות.</p>
        ) : (
          <ul aria-label="ספריית התמונות" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data!.assets.map((a) => (
              <li key={a.id} className="group relative">
                <button
                  type="button"
                  onClick={() => {
                    onSelect(a);
                    onOpenChange(false);
                  }}
                  aria-pressed={selectedId === a.id}
                  aria-label={`בחירת ${a.originalName ?? 'תמונה'}`}
                  className={cn(
                    'block w-full overflow-hidden rounded-xl border-2 bg-surface-muted',
                    selectedId === a.id
                      ? 'border-brand-500'
                      : 'border-transparent hover:border-brand-200',
                  )}
                >
                  <img
                    src={a.url}
                    alt=""
                    loading="lazy"
                    className="aspect-[4/3] w-full object-cover"
                  />
                </button>
                {selectedId === a.id && (
                  <span
                    aria-hidden
                    className="absolute end-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white"
                  >
                    <Check className="h-4 w-4" />
                  </span>
                )}
                {confirm === a.id ? (
                  <div className="mt-1 flex items-center gap-1 text-xs">
                    <button
                      type="button"
                      className="font-medium text-danger-600 underline"
                      onClick={() => remove.mutate(a.id, { onSettled: () => setConfirm(null) })}
                    >
                      מחיקה
                    </button>
                    <span className="text-ink-subtle">·</span>
                    <button
                      type="button"
                      className="text-ink-muted underline"
                      onClick={() => setConfirm(null)}
                    >
                      ביטול
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirm(a.id)}
                    aria-label={`מחיקת ${a.originalName ?? 'תמונה'}`}
                    className="absolute start-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-surface/90 text-ink-muted opacity-0 shadow-sm transition-opacity hover:text-danger-600 focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 aria-hidden className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {data && (
          <div className="flex flex-col gap-1">
            <div
              role="progressbar"
              aria-label="נפח אחסון בשימוש"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={usedPct}
              className="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
            >
              <div
                className={cn(
                  'h-full rounded-full',
                  usedPct > 90 ? 'bg-danger-600' : 'bg-brand-500',
                )}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <p className="text-xs text-ink-muted">
              <bdi dir="ltr">
                {formatBytes(data.usedBytes)} / {formatBytes(data.quotaBytes)}
              </bdi>{' '}
              בשימוש
            </p>
          </div>
        )}
      </div>
    </DialogShell>
  );
}
