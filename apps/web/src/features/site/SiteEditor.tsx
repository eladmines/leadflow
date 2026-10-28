import {
  can,
  FONT_KEYS,
  FONTS,
  newSection,
  PALETTE_KEYS,
  PALETTES,
  renderSitePage,
  SECTION_TYPES,
  sectionTypeLabels,
  SITE_LIMITS,
  type Section,
  type SectionType,
  type Site,
} from '@leadflow/shared';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CircleAlert,
  Cloud,
  ExternalLink,
  History,
  Eye,
  EyeOff,
  Loader2,
  Monitor,
  Plus,
  SlidersHorizontal,
  Smartphone,
  X,
} from 'lucide-react';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Alert, Button, Field, Select, Textarea } from '../../components/ui';
import { cn } from '../../lib/cn';
import { useCurrentBusiness } from '../shell/CurrentBusiness';
import { ImageField } from '../media/ImageField';
import { useMediaMap } from '../media/api';
import { siteBusinessInfo } from './api';
import { useServices } from '../appointments/api';
import { EditablePreview } from './EditablePreview';
import { setSectionField } from './fieldPath';
import { BusinessDetailsDialog } from './BusinessDetailsDialog';
import { MediaPicker } from '../media/MediaPicker';
import { PreviewFrame } from './PreviewFrame';
import { PublishDialog } from './PublishDialog';
import { VersionsDialog } from './VersionsDialog';
import { SectionForm } from './SectionForm';
import { useDraftAutosave, type Draft, type SaveState } from './useDraftAutosave';

type Tab = 'sections' | 'design' | 'seo';

const newId = () => `s${Math.random().toString(36).slice(2, 10)}`;
const iconBtn =
  'flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent';

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const map: Record<SaveState, { icon: typeof Cloud; text: string; className: string }> = {
    saved: { icon: Cloud, text: 'כל השינויים נשמרו', className: 'text-ink-muted' },
    pending: { icon: Loader2, text: 'שומר…', className: 'text-ink-muted' },
    saving: { icon: Loader2, text: 'שומר…', className: 'text-ink-muted' },
    error: { icon: CircleAlert, text: 'השמירה נכשלה', className: 'text-danger-600' },
    conflict: { icon: CircleAlert, text: 'נערך בחלון אחר', className: 'text-danger-600' },
  };
  const { icon: Icon, text, className } = map[state];
  return (
    <span role="status" className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
      <Icon
        aria-hidden
        className={cn('h-4 w-4', (state === 'saving' || state === 'pending') && 'animate-spin')}
      />
      {text}
      {state === 'error' && (
        <button type="button" onClick={onRetry} className="font-medium underline">
          נסו שוב
        </button>
      )}
    </span>
  );
}

export function SiteEditor({ site, initialDraft }: { site: Site; initialDraft?: Draft }) {
  const business = useCurrentBusiness();
  const editable = can(business.role, 'site.edit');
  const canPublish = can(business.role, 'site.publish');
  const [publishOpen, setPublishOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(
    initialDraft ?? {
      templateKey: site.templateKey,
      theme: site.theme,
      seo: site.seo,
      sections: site.sections,
    },
  );
  const { state, retry, revision } = useDraftAutosave(business.id, site, draft);
  const live = site.published;
  const unpublishedChanges = live !== null && (live.revision !== revision() || state !== 'saved');
  const [tab, setTab] = useState<Tab>('sections');
  // Desktop: the page gets the full width; the settings panel opens on demand (D-072).
  // Below `lg` the panel is always shown (it's the main way to edit on a phone).
  const [panelOpen, setPanelOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [adding, setAdding] = useState<SectionType>('services');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const services = useServices(business.id).data;
  const info = useMemo(
    () => ({
      ...siteBusinessInfo(business),
      // The appointment request offers the active services (as on the published site).
      services: (services ?? []).filter((x) => x.active).map(({ id, name }) => ({ id, name })),
    }),
    [business, services],
  );
  const deferred = useDeferredValue(draft);
  const media = useMediaMap(business.id);
  const html = useMemo(
    () => renderSitePage(deferred, info, media, { editor: editable }),
    [deferred, info, media, editable],
  );

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const updateSection = (id: string, patch: Partial<Section>) =>
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s) => (s.id === id ? ({ ...s, ...patch } as Section) : s)),
    }));
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const sections = [...d.sections];
      [sections[i], sections[i + dir]] = [sections[i + dir]!, sections[i]!];
      return { ...d, sections };
    });
  const current = draft.sections.find((s) => s.id === selected);
  const select = useCallback((id: string) => {
    setSelected(id);
    setConfirmDelete(false);
  }, []);
  const moveById = (id: string, dir: -1 | 1) => {
    const i = draft.sections.findIndex((s) => s.id === id);
    if (i + dir >= 0 && i + dir < draft.sections.length) move(i, dir);
  };
  const setField = useCallback(
    (id: string, path: string, value: string | null) =>
      setDraft((d) => {
        // The logo is chosen by clicking it on the page (D-076).
        if (id === '$theme' && path === 'logoAssetId') {
          return { ...d, theme: { ...d.theme, logoAssetId: value } };
        }
        // Fixed button wording lives on the theme (D-075).
        if (id === '$theme' && path.startsWith('labels.')) {
          const key = path.slice('labels.'.length);
          return { ...d, theme: { ...d.theme, labels: { ...d.theme.labels, [key]: value ?? '' } } };
        }
        return {
          ...d,
          sections: d.sections.map((s) =>
            s.id !== id
              ? s
              : value === null
                ? ({ ...s, [path]: null } as Section)
                : setSectionField(s, path, value),
          ),
        };
      }),
    [],
  );
  const [bizOpen, setBizOpen] = useState(false);
  const [imagePick, setImagePick] = useState<{ id: string; path: string } | null>(null);
  /** On-page list controls (D-072): add a blank item, move one, or delete it. */
  const itemAction = (id: string, action: 'add' | 'up' | 'down' | 'del', n: number) =>
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s) => {
        if (s.id !== id || !('items' in s)) return s;
        const items = [...(s.items as Record<string, unknown>[])];
        if (action === 'add') {
          const template = (newSection(s.type, s.id) as { items?: Record<string, unknown>[] })
            .items?.[0];
          if (!template || items.length >= SITE_LIMITS.items) return s;
          items.push(Object.fromEntries(Object.keys(template).map((k) => [k, ''])));
        } else if (action === 'del') {
          items.splice(n, 1);
        } else {
          const j = action === 'up' ? n - 1 : n + 1;
          if (j < 0 || j >= items.length) return s;
          [items[n], items[j]] = [items[j]!, items[n]!];
        }
        return { ...s, items } as Section;
      }),
    }));
  const insertAfter = (afterId: string, type: SectionType) => {
    const s = newSection(type, newId());
    setDraft((d) => {
      const i = d.sections.findIndex((x) => x.id === afterId);
      const sections = [...d.sections];
      sections.splice(i + 1, 0, s);
      return { ...d, sections };
    });
    select(s.id);
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'sections', label: 'מקטעים' },
    { key: 'design', label: 'עיצוב' },
    { key: 'seo', label: 'גוגל' },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">האתר שלי</h1>
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-medium',
                !live && 'bg-surface-sunken text-ink-muted',
                live && !unpublishedChanges && 'bg-success-50 text-success-600',
                live && unpublishedChanges && 'bg-accent-50 text-accent-700',
              )}
            >
              {!live
                ? 'טיוטה · לא פורסם'
                : unpublishedChanges
                  ? 'באוויר · יש שינויים שלא פורסמו'
                  : 'באוויר'}
            </span>
          </div>
          {live && site.publicUrl ? (
            <a
              href={site.publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-brand-700 hover:underline"
            >
              <bdi dir="ltr">{site.publicUrl.replace(/^https?:\/\//, '')}</bdi>
              <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              <span className="sr-only">(נפתח בחלון חדש)</span>
            </a>
          ) : (
            <p className="text-sm text-ink-muted">
              עורכים את הטיוטה. האתר יעלה לאוויר רק אחרי פרסום.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {editable && <SaveIndicator state={state} onRetry={retry} />}
          {live !== null || canPublish ? (
            <Button variant="ghost" onClick={() => setHistoryOpen(true)}>
              <History aria-hidden className="h-4 w-4" />
              היסטוריה
            </Button>
          ) : null}
          {canPublish && (
            <Button onClick={() => setPublishOpen(true)}>
              {live ? 'פרסום השינויים' : 'פרסום האתר'}
            </Button>
          )}
        </div>
      </div>

      {state === 'conflict' && (
        <Alert tone="danger" title="האתר נערך בחלון אחר">
          כדי לא לדרוס שינויים, השמירה האוטומטית הופסקה.{' '}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => window.location.reload()}
          >
            טעינה מחדש
          </button>
        </Alert>
      )}
      {!editable && (
        <Alert tone="info">רק בעל/ת העסק יכול/ה לערוך את האתר. כאן אפשר לצפות בטיוטה.</Alert>
      )}

      {canPublish && (
        <PublishDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          site={site}
          businessId={business.id}
          saveState={state}
          revision={revision}
        />
      )}
      {editable && <BusinessDetailsDialog open={bizOpen} onOpenChange={setBizOpen} />}
      {editable && (
        <MediaPicker
          open={imagePick !== null}
          onOpenChange={(open) => !open && setImagePick(null)}
          title="בחירת תמונה"
          onSelect={(asset) => {
            if (imagePick) setField(imagePick.id, imagePick.path, asset.id);
            setImagePick(null);
          }}
        />
      )}
      <VersionsDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        site={site}
        businessId={business.id}
        canPublish={canPublish}
      />

      <div className={cn('grid gap-5', panelOpen && 'lg:grid-cols-[340px_minmax(0,1fr)]')}>
        {editable && (
          <aside
            aria-label="הגדרות האתר"
            className={cn(
              'flex max-h-none flex-col rounded-3xl border border-surface-border bg-surface shadow-card lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)]',
              !panelOpen && 'lg:hidden',
            )}
          >
            <div className="hidden items-center justify-between border-b border-surface-border px-4 py-2.5 lg:flex">
              <span className="text-sm font-semibold text-ink">הגדרות</span>
              <button
                type="button"
                aria-label="סגירת ההגדרות"
                onClick={() => {
                  setPanelOpen(false);
                  setSelected(null);
                }}
                className={iconBtn}
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>
            {!current && (
              <div
                role="tablist"
                aria-label="עריכת האתר"
                className="flex gap-1 border-b border-surface-border p-2"
              >
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    id={`tab-${t.key}`}
                    aria-selected={tab === t.key}
                    aria-controls={`panel-${t.key}`}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      'flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                      tab === t.key
                        ? 'bg-brand-50 text-brand-800'
                        : 'text-ink-muted hover:bg-surface-sunken',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4">
              {current ? (
                <div className="flex flex-col gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      setConfirmDelete(false);
                    }}
                    className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-brand-700 hover:underline"
                  >
                    <ArrowRight aria-hidden className="h-4 w-4" />
                    כל המקטעים
                  </button>
                  <h2 className="text-lg font-semibold text-ink">
                    {sectionTypeLabels[current.type]}
                  </h2>
                  <SectionForm section={current} onChange={(p) => updateSection(current.id, p)} />
                  <div className="border-t border-surface-border pt-4">
                    {confirmDelete ? (
                      <div
                        className="flex flex-wrap items-center gap-2"
                        role="group"
                        aria-label="אישור מחיקה"
                      >
                        <span className="text-sm text-ink">למחוק את המקטע?</span>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            update({ sections: draft.sections.filter((s) => s.id !== current.id) });
                            setSelected(null);
                            setConfirmDelete(false);
                          }}
                        >
                          מחיקה
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                          ביטול
                        </Button>
                      </div>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                        מחיקת המקטע
                      </Button>
                    )}
                  </div>
                </div>
              ) : tab === 'sections' ? (
                <div
                  id="panel-sections"
                  role="tabpanel"
                  aria-labelledby="tab-sections"
                  className="flex flex-col gap-4"
                >
                  <p className="rounded-2xl bg-brand-50 px-3 py-2.5 text-sm text-brand-800">
                    אפשר ללחוץ על כל חלק באתר שבתצוגה המקדימה כדי לערוך, להזיז או להסתיר אותו.
                  </p>
                  <ol aria-label="מקטעי האתר" className="flex flex-col gap-2">
                    {draft.sections.map((s, i) => (
                      <li
                        key={s.id}
                        className={cn(
                          'flex items-center gap-1 rounded-2xl border border-surface-border p-1.5 ps-3',
                          !s.visible && 'bg-surface-muted',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setSelected(s.id)}
                          className="flex min-w-0 flex-1 flex-col items-start rounded-lg py-1 text-start"
                        >
                          <span
                            className={cn(
                              'text-sm font-medium',
                              s.visible ? 'text-ink' : 'text-ink-subtle',
                            )}
                          >
                            {sectionTypeLabels[s.type]}
                          </span>
                          <span className="w-full truncate text-xs text-ink-muted">
                            {s.title || 'ללא כותרת'}
                          </span>
                        </button>
                        <button
                          type="button"
                          className={iconBtn}
                          aria-pressed={!s.visible}
                          aria-label={
                            s.visible
                              ? `הסתרת ${sectionTypeLabels[s.type]}`
                              : `הצגת ${sectionTypeLabels[s.type]}`
                          }
                          onClick={() => updateSection(s.id, { visible: !s.visible })}
                        >
                          {s.visible ? (
                            <Eye aria-hidden className="h-4 w-4" />
                          ) : (
                            <EyeOff aria-hidden className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          className={iconBtn}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                          aria-label={`הזזת ${sectionTypeLabels[s.type]} למעלה`}
                        >
                          <ArrowUp aria-hidden className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className={iconBtn}
                          disabled={i === draft.sections.length - 1}
                          onClick={() => move(i, 1)}
                          aria-label={`הזזת ${sectionTypeLabels[s.type]} למטה`}
                        >
                          <ArrowDown aria-hidden className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ol>
                  {draft.sections.length < SITE_LIMITS.sections && (
                    <div className="flex items-end gap-2 rounded-2xl bg-surface-muted p-3">
                      <div className="flex-1">
                        <Select
                          label="הוספת מקטע"
                          options={SECTION_TYPES.map((t) => ({
                            value: t,
                            label: sectionTypeLabels[t],
                          }))}
                          value={adding}
                          onChange={(e) => setAdding(e.target.value as SectionType)}
                        />
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          const s = newSection(adding, newId());
                          update({ sections: [...draft.sections, s] });
                          setSelected(s.id);
                        }}
                      >
                        <Plus aria-hidden className="h-4 w-4" />
                        הוספה
                      </Button>
                    </div>
                  )}
                </div>
              ) : tab === 'design' ? (
                <div
                  id="panel-design"
                  role="tabpanel"
                  aria-labelledby="tab-design"
                  className="flex flex-col gap-6"
                >
                  <ImageField
                    label="לוגו"
                    hint="מוצג בראש האתר ליד שם העסק. עדיף לוגו על רקע שקוף או לבן."
                    value={draft.theme.logoAssetId}
                    onChange={(logoAssetId) => update({ theme: { ...draft.theme, logoAssetId } })}
                  />
                  <fieldset className="flex flex-col gap-3">
                    <legend className="mb-2 text-sm font-medium text-ink">צבעים</legend>
                    <div className="grid grid-cols-2 gap-2">
                      {PALETTE_KEYS.map((k) => (
                        <label
                          key={k}
                          className={cn(
                            'flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500',
                            draft.theme.palette === k
                              ? 'border-brand-500 bg-brand-50'
                              : 'border-surface-border hover:bg-surface-muted',
                          )}
                        >
                          <input
                            type="radio"
                            name="palette"
                            value={k}
                            checked={draft.theme.palette === k}
                            onChange={() => update({ theme: { ...draft.theme, palette: k } })}
                            className="sr-only"
                          />
                          <span aria-hidden className="flex">
                            <span
                              className="h-5 w-5 rounded-full ring-2 ring-white"
                              style={{ background: PALETTES[k].primary }}
                            />
                            <span
                              className="-ms-1.5 h-5 w-5 rounded-full ring-2 ring-white"
                              style={{ background: PALETTES[k].accent }}
                            />
                          </span>
                          {PALETTES[k].label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-sm font-medium text-ink">גופן</legend>
                    {FONT_KEYS.map((k) => (
                      <label
                        key={k}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500',
                          draft.theme.font === k
                            ? 'border-brand-500 bg-brand-50'
                            : 'border-surface-border hover:bg-surface-muted',
                        )}
                      >
                        <input
                          type="radio"
                          name="font"
                          value={k}
                          checked={draft.theme.font === k}
                          onChange={() => update({ theme: { ...draft.theme, font: k } })}
                          className="accent-brand-600"
                        />
                        {FONTS[k].label}
                      </label>
                    ))}
                  </fieldset>
                </div>
              ) : (
                <div
                  id="panel-seo"
                  role="tabpanel"
                  aria-labelledby="tab-seo"
                  className="flex flex-col gap-4"
                >
                  <p className="text-sm text-ink-muted">כך האתר יופיע בתוצאות החיפוש בגוגל.</p>
                  <Field
                    label="כותרת בגוגל"
                    maxLength={70}
                    hint={`${draft.seo.title.length}/70`}
                    value={draft.seo.title}
                    onChange={(e) => update({ seo: { ...draft.seo, title: e.target.value } })}
                  />
                  <Textarea
                    label="תיאור בגוגל"
                    maxLength={160}
                    hint={`${draft.seo.description.length}/160`}
                    value={draft.seo.description}
                    onChange={(e) => update({ seo: { ...draft.seo, description: e.target.value } })}
                  />
                  <div className="rounded-2xl border border-surface-border p-4">
                    <p className="truncate text-base text-[#1a0dab]">
                      {draft.seo.title || business.name}
                    </p>
                    <p className="line-clamp-2 text-sm text-ink-muted">{draft.seo.description}</p>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}

        <section aria-label="תצוגה מקדימה" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {editable && (
                <Button
                  variant={panelOpen ? 'secondary' : 'primary'}
                  size="sm"
                  className="hidden lg:inline-flex"
                  aria-expanded={panelOpen}
                  onClick={() => {
                    // Always opens on the overview (sections, design, Google), not a section.
                    setSelected(null);
                    setPanelOpen((o) => !o);
                  }}
                >
                  <SlidersHorizontal aria-hidden className="h-4 w-4" />
                  {panelOpen ? 'סגירת ההגדרות' : 'מקטעים, עיצוב וגוגל'}
                </Button>
              )}
              <p className="text-sm font-medium text-ink-muted">
                {editable ? 'לחצו על טקסט או תמונה באתר כדי לשנות אותם' : 'תצוגה מקדימה'}
              </p>
            </div>
            <div
              role="group"
              aria-label="גודל מסך"
              className="flex rounded-xl bg-surface-sunken p-1"
            >
              {(['desktop', 'mobile'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={device === d}
                  onClick={() => setDevice(d)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm',
                    device === d ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted',
                  )}
                >
                  {d === 'desktop' ? (
                    <Monitor aria-hidden className="h-4 w-4" />
                  ) : (
                    <Smartphone aria-hidden className="h-4 w-4" />
                  )}
                  {d === 'desktop' ? 'מחשב' : 'נייד'}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[70vh] min-h-[480px] lg:h-[calc(100vh-12rem)]">
            {editable ? (
              <EditablePreview
                html={html}
                device={device}
                sections={draft.sections}
                selected={selected}
                onSelect={select}
                onMove={moveById}
                onHide={(id) => updateSection(id, { visible: false })}
                onInsert={insertAfter}
                onItem={itemAction}
                onBusiness={() => setBizOpen(true)}
                onSettings={(id) => {
                  select(id);
                  setPanelOpen(true);
                }}
                onText={setField}
                onImage={(id, path) => setImagePick({ id, path })}
              />
            ) : (
              <PreviewFrame html={html} title="תצוגה מקדימה של האתר" device={device} />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
