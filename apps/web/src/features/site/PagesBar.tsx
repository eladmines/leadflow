import {
  PAGE_PRESETS,
  pageSlugSchema,
  siteMessages,
  SITE_LIMITS,
  type PagePresetKey,
  type SitePage,
} from '@leadflow/shared';
import { FileText, Plus, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Checkbox, DialogShell, Field } from '../../components/ui';
import { cn } from '../../lib/cn';
import type { PageId } from './pages';

const presetHints: Record<PagePresetKey, string> = {
  about: 'סיפור העסק, המלצות וקריאה לפעולה',
  services: 'שירותים ומחירון',
  gallery: 'תמונות מהעבודה',
  faq: 'שאלות נפוצות וטופס',
  contact: 'פרטי התקשרות וטופס',
  landing: 'לפרסום או מבצע: לא מופיע בתפריט',
  blank: 'מתחילים מאפס',
};

/** Page switcher, "new page" and page settings for the site editor (D-081). */
export function PagesBar({
  pages,
  pageId,
  editable,
  onSelect,
  onAdd,
  onUpdate,
  onDelete,
}: {
  pages: SitePage[];
  pageId: PageId;
  editable: boolean;
  onSelect: (id: PageId) => void;
  onAdd: (preset: PagePresetKey) => void;
  onUpdate: (id: string, patch: Partial<SitePage>) => void;
  onDelete: (id: string) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const current = pages.find((p) => p.id === pageId);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FileText aria-hidden className="h-4 w-4 text-ink-muted" />
      <select
        aria-label="העמוד שעורכים"
        value={pageId}
        onChange={(e) => onSelect(e.target.value)}
        className="h-8 max-w-[14rem] rounded-lg border border-surface-border bg-surface px-2 text-sm text-ink"
      >
        <option value="">ראשי (/)</option>
        {pages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title} (/{p.slug}){p.inMenu ? '' : ' · לא בתפריט'}
          </option>
        ))}
      </select>
      {editable && current && (
        <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}>
          <Settings2 aria-hidden className="h-4 w-4" />
          הגדרות העמוד
        </Button>
      )}
      {editable && (
        <Button
          size="sm"
          variant="secondary"
          disabled={pages.length >= SITE_LIMITS.pages}
          title={pages.length >= SITE_LIMITS.pages ? siteMessages.tooManyPages : undefined}
          onClick={() => setAddOpen(true)}
        >
          <Plus aria-hidden className="h-4 w-4" />
          עמוד חדש
        </Button>
      )}

      <DialogShell open={addOpen} onOpenChange={setAddOpen} title="עמוד חדש">
        <p className="text-sm text-ink-muted">
          בחרו סוג עמוד. אפשר לשנות כל טקסט, מקטע וכתובת אחר כך.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(PAGE_PRESETS) as PagePresetKey[]).map((k) => (
            <li key={k}>
              <button
                type="button"
                onClick={() => {
                  onAdd(k);
                  setAddOpen(false);
                }}
                className="flex w-full flex-col items-start gap-0.5 rounded-xl border border-surface-border p-3 text-start hover:border-brand-300 hover:bg-brand-50/50"
              >
                <span className="text-sm font-semibold text-ink">{PAGE_PRESETS[k].label}</span>
                <span className="text-xs text-ink-muted">{presetHints[k]}</span>
              </button>
            </li>
          ))}
        </ul>
      </DialogShell>

      {current && (
        <PageSettings
          key={current.id}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          page={current}
          taken={pages.filter((p) => p.id !== current.id).map((p) => p.slug)}
          onSave={(patch) => onUpdate(current.id, patch)}
          onDelete={() => onDelete(current.id)}
        />
      )}
    </div>
  );
}

function PageSettings({
  open,
  onOpenChange,
  page,
  taken,
  onSave,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  page: SitePage;
  taken: string[];
  onSave: (patch: Partial<SitePage>) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [inMenu, setInMenu] = useState(page.inMenu);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(page.title);
    setSlug(page.slug);
    setInMenu(page.inMenu);
    setConfirmDelete(false);
  }, [open, page]);

  const parsed = pageSlugSchema.safeParse(slug);
  const slugError = !parsed.success
    ? parsed.error.issues[0]?.message
    : taken.includes(parsed.data)
      ? siteMessages.pageSlugTaken
      : undefined;
  const titleError = title.trim() ? undefined : siteMessages.pageTitleRequired;

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} title="הגדרות העמוד">
      <Field
        label="שם העמוד (בתפריט)"
        maxLength={30}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        error={titleError}
      />
      <Field
        label="כתובת העמוד"
        ltr
        hint="אותיות באנגלית, ספרות ומקף. למשל: about"
        value={slug}
        onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
        error={slugError}
      />
      <Checkbox
        label="להציג בתפריט האתר"
        checked={inMenu}
        onChange={(e) => setInMenu(e.target.checked)}
      />
      <p className="text-xs text-ink-muted">
        את הכותרת והתיאור לגוגל של העמוד עורכים בלשונית "גוגל" כשהעמוד פתוח.
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-border pt-4">
        {confirmDelete ? (
          <span role="group" aria-label="אישור מחיקת העמוד" className="flex items-center gap-2">
            <span className="text-sm text-ink">למחוק את העמוד וכל המקטעים שבו?</span>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                onDelete();
                onOpenChange(false);
              }}
            >
              מחיקה
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              ביטול
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className={cn('text-danger-600')}
            onClick={() => setConfirmDelete(true)}
          >
            מחיקת העמוד
          </Button>
        )}
        <Button
          disabled={Boolean(slugError || titleError)}
          onClick={() => {
            onSave({ title: title.trim(), slug: parsed.success ? parsed.data : page.slug, inMenu });
            onOpenChange(false);
          }}
        >
          שמירה
        </Button>
      </div>
    </DialogShell>
  );
}
