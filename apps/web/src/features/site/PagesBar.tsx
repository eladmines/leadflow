import {
  PAGE_PRESETS,
  pageSlugSchema,
  siteMessages,
  SITE_LIMITS,
  type PagePresetKey,
  type SitePage,
  type SiteSeo,
} from '@leadflow/shared';
import { EyeOff, FileText, Plus, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Checkbox, DialogShell, Field, Textarea } from '../../components/ui';
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
  seo,
  onSeo,
}: {
  pages: SitePage[];
  pageId: PageId;
  editable: boolean;
  onSelect: (id: PageId) => void;
  onAdd: (preset: PagePresetKey) => void;
  onUpdate: (id: string, patch: Partial<SitePage>) => void;
  onDelete: (id: string) => void;
  /** Google title/description of the page being edited (the home page's too). */
  seo: SiteSeo;
  onSeo: (seo: SiteSeo) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const current = pages.find((p) => p.id === pageId);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 ps-1 text-xs font-medium text-ink-muted">
        <FileText aria-hidden className="h-3.5 w-3.5" />
        עמודים
      </span>
      <div
        role="tablist"
        aria-label="עמודי האתר"
        className="flex max-w-[30rem] items-center gap-0.5 overflow-x-auto rounded-lg bg-surface-sunken p-0.5"
      >
        {[{ id: '', title: 'ראשי', inMenu: true }, ...pages].map((p) => (
          <button
            key={p.id || 'home'}
            type="button"
            role="tab"
            aria-selected={pageId === p.id}
            onClick={() => onSelect(p.id)}
            title={p.inMenu ? undefined : 'לא מופיע בתפריט האתר'}
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-sm',
              pageId === p.id
                ? 'bg-surface font-medium text-ink shadow-card'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {p.title}
            {!p.inMenu && <EyeOff aria-label="(לא בתפריט)" className="h-3 w-3" />}
          </button>
        ))}
      </div>
      {editable && (
        <button
          type="button"
          aria-label="עמוד חדש"
          title={pages.length >= SITE_LIMITS.pages ? siteMessages.tooManyPages : 'עמוד חדש'}
          disabled={pages.length >= SITE_LIMITS.pages}
          onClick={() => setAddOpen(true)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-40"
        >
          <Plus aria-hidden className="h-4 w-4" />
        </button>
      )}
      {editable && (
        <Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}>
          <Settings2 aria-hidden className="h-4 w-4" />
          הגדרות העמוד
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

      <PageSettings
        key={current?.id ?? 'home'}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        page={current}
        seo={seo}
        taken={pages.filter((p) => p.id !== current?.id).map((p) => p.slug)}
        onSave={(patch, nextSeo) => {
          if (current) onUpdate(current.id, patch);
          onSeo(nextSeo);
        }}
        onDelete={() => current && onDelete(current.id)}
      />
    </div>
  );
}

function PageSettings({
  open,
  onOpenChange,
  page,
  seo,
  taken,
  onSave,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undefined = the home page (Google settings only). */
  page: SitePage | undefined;
  seo: SiteSeo;
  taken: string[];
  onSave: (patch: Partial<SitePage>, seo: SiteSeo) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(page?.title ?? '');
  const [slug, setSlug] = useState(page?.slug ?? '');
  const [inMenu, setInMenu] = useState(page?.inMenu ?? true);
  const [seoTitle, setSeoTitle] = useState(seo.title);
  const [seoDescription, setSeoDescription] = useState(seo.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(page?.title ?? '');
    setSlug(page?.slug ?? '');
    setInMenu(page?.inMenu ?? true);
    setSeoTitle(seo.title);
    setSeoDescription(seo.description);
    setConfirmDelete(false);
  }, [open, page, seo]);

  const parsed = pageSlugSchema.safeParse(slug);
  const slugError = !page
    ? undefined
    : !parsed.success
      ? parsed.error.issues[0]?.message
      : taken.includes(parsed.data)
        ? siteMessages.pageSlugTaken
        : undefined;
  const titleError = !page || title.trim() ? undefined : siteMessages.pageTitleRequired;

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={page ? 'הגדרות העמוד' : 'הגדרות עמוד הבית'}
    >
      {page && (
        <>
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
        </>
      )}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium text-ink">איך העמוד יופיע בגוגל</legend>
        <Field
          label="כותרת בגוגל"
          maxLength={70}
          hint={`${seoTitle.length}/70`}
          value={seoTitle}
          onChange={(e) => setSeoTitle(e.target.value)}
        />
        <Textarea
          label="תיאור בגוגל"
          maxLength={160}
          rows={2}
          hint={`${seoDescription.length}/160`}
          value={seoDescription}
          onChange={(e) => setSeoDescription(e.target.value)}
        />
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-border pt-4">
        {!page ? (
          <span />
        ) : confirmDelete ? (
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
            onSave(
              page
                ? { title: title.trim(), slug: parsed.success ? parsed.data : page.slug, inMenu }
                : {},
              { title: seoTitle, description: seoDescription },
            );
            onOpenChange(false);
          }}
        >
          שמירה
        </Button>
      </div>
    </DialogShell>
  );
}
