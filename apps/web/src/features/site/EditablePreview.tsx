import {
  SECTION_TYPES,
  sectionTypeLabels,
  SITE_LIMITS,
  type Section,
  type SectionType,
} from '@leadflow/shared';
import { ArrowDown, ArrowUp, EyeOff, ImageIcon, Plus, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { fieldLimit } from './fieldPath';

/** Sections are direct children of <main> with id `s-<sectionId>` (see renderSitePage). */
const SECTION_SELECTOR = 'main > [id^="s-"]';

interface Rect {
  top: number;
  height: number;
}

const toolBtn =
  'flex h-8 w-8 items-center justify-center rounded-lg text-white hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-transparent';

/**
 * The editor preview with in-page editing (D-070, D-071): hover a section to see a toolbar (edit,
 * image, move, hide) and a "+" to insert a section after it; click a section to open its form;
 * click a text to type in place; click a photo to replace it. The page itself still runs no
 * scripts: the iframe allows same-origin access only, and all listeners and tools live in this
 * (parent) document. Links and forms are inert here.
 *
 * While a text is being typed the preview is frozen (the iframe isn't reloaded with each
 * keystroke, which would lose the caret); every change still goes straight into the draft.
 */
export function EditablePreview({
  html,
  device,
  sections,
  selected,
  onSelect,
  onMove,
  onHide,
  onInsert,
  onText,
  onImage,
  onItem,
  onAddSection,
  onSettings,
  onBusiness,
  onNavigate,
  onDeselect,
  onDesign,
  inspector,
  textTools,
}: {
  html: string;
  device: 'desktop' | 'mobile';
  sections: Section[];
  selected: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onHide: (id: string) => void;
  onInsert: (afterId: string, type: SectionType) => void;
  onText: (id: string, path: string, value: string) => void;
  onImage: (id: string, path: string) => void;
  /** On-page list controls: add an item, move one, or delete it. */
  onItem: (id: string, action: 'add' | 'up' | 'down' | 'del', index: number) => void;
  /** Adds a section at the end of the page (the empty-page picker). */
  onAddSection: (type: SectionType) => void;
  /** Opens the section's settings panel. */
  onSettings: (id: string) => void;
  /** Phone, address, hours or areas were clicked: they live in the business profile (D-075). */
  onBusiness: () => void;
  /** A link to another page of the site was clicked (`/about`, `/`): open it (D-081). */
  onNavigate: (slug: string) => void;
  /** A click outside any section closes the section window. */
  onDeselect: () => void;
  /** The logo or the header was clicked: open the site design window (D-082). */
  onDesign: () => void;
  /** The selected section's settings window, shown next to it (D-082, desktop). */
  inspector?: ReactNode;
  /** Small toolbar above the text being typed (title colour/size, button style); `done`
   *  finishes the typing so the change shows. */
  textTools?: (id: string, path: string, done: () => void) => ReactNode;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const scrollY = useRef(0);
  const [doc, setDoc] = useState<Document | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [frozen, setFrozen] = useState<string | null>(null);
  /** The page the iframe has finished loading (to tell when a re-render is on screen). */
  const [loaded, setLoaded] = useState<string | null>(null);
  const htmlRef = useRef(html);
  htmlRef.current = html;
  const editing = useRef<{ el: HTMLElement; id: string; path: string; multi: boolean } | null>(
    null,
  );
  const handlers = useRef({
    onSelect,
    onText,
    onImage,
    onItem,
    onAddSection,
    onBusiness,
    onNavigate,
    onDeselect,
    onDesign,
    sections,
  });
  handlers.current = {
    onSelect,
    onText,
    onImage,
    onItem,
    onAddSection,
    onBusiness,
    onNavigate,
    onDeselect,
    onDesign,
    sections,
  };
  /** The text being typed and where it is (for the text toolbar). */
  const [typing, setTyping] = useState<{
    id: string;
    path: string;
    top: number;
    bottom: number;
    left: number;
  } | null>(null);
  /** A field to start typing in after the next reload (a just-added list item). */
  const pendingFocus = useRef<string | null>(null);

  const measure = useCallback(() => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    const next: Record<string, Rect> = {};
    for (const el of d.querySelectorAll<HTMLElement>(SECTION_SELECTOR)) {
      const r = el.getBoundingClientRect();
      next[el.id.slice(2)] = { top: r.top, height: r.height };
    }
    setRects(next);
  }, []);

  // Each edit re-renders the page (new srcdoc); keep the visitor's scroll position across reloads.
  const onLoad = () => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    setLoaded(frame.current?.getAttribute('srcdoc') ?? null);
    d.defaultView?.scrollTo({ top: scrollY.current, behavior: 'instant' });
    setDoc(d);
    measure();
  };

  useEffect(() => {
    if (!doc) return;
    const win = doc.defaultView;
    const element = (t: EventTarget | null) => (win && t instanceof win.Element ? t : null);
    const sectionId = (t: EventTarget | null) =>
      element(t)?.closest(SECTION_SELECTOR)?.id.slice(2) ?? null;
    const field = (attr: string, t: EventTarget | null) => {
      const el = element(t)?.closest<HTMLElement>(`[${attr}]`);
      const value = el?.getAttribute(attr);
      const at = value?.indexOf(':') ?? -1;
      return el && value && at > 0
        ? { el, id: value.slice(0, at), path: value.slice(at + 1) }
        : null;
    };
    const read = (el: HTMLElement, multi: boolean) =>
      multi ? el.innerText.replace(/\n{3,}/g, '\n\n') : (el.textContent ?? '').replace(/\s+/g, ' ');

    // Pressing on a text makes it editable before the browser places the caret there.
    const onDown = (e: Event) => {
      setMenuFor(null);
      begin(field('data-edit', e.target));
    };
    const begin = (f: { el: HTMLElement; id: string; path: string } | null) => {
      if (!f || editing.current?.el === f.el) return;
      // Moving straight to another text: finish the previous one without unfreezing in between.
      const prev = editing.current;
      if (prev) {
        handlers.current.onText(prev.id, prev.path, read(prev.el, prev.multi).trim());
        prev.el.removeAttribute('contenteditable');
      }
      f.el.setAttribute('contenteditable', 'plaintext-only');
      if (f.el.contentEditable !== 'plaintext-only') f.el.setAttribute('contenteditable', 'true');
      editing.current = { ...f, multi: f.el.hasAttribute('data-multi') };
      const r = f.el.getBoundingClientRect();
      setTyping({ id: f.id, path: f.path, top: r.top, bottom: r.bottom, left: r.left });
      setFrozen((cur) => cur ?? htmlRef.current);
      setHovered(null);
      setMenuFor(null);
    };
    const onOver = (e: Event) => {
      if (!editing.current) setHovered(sectionId(e.target));
    };
    const onClick = (e: Event) => {
      e.preventDefault(); // links (tel:, anchors) and the lead form are inert in the editor
      const act = element(e.target)?.closest<HTMLElement>('[data-act]');
      if (act?.getAttribute('data-act') === 'new') {
        // The empty-page picker: add the first section of this page.
        return handlers.current.onAddSection(act.getAttribute('data-at') as SectionType);
      }
      if (act) {
        const [id = '', n] = (act.getAttribute('data-at') ?? '').split(':');
        const action = act.getAttribute('data-act') as 'add' | 'up' | 'down' | 'del';
        if (action === 'add') {
          const s = handlers.current.sections.find((x) => x.id === id);
          if (s && 'items' in s) pendingFocus.current = `${id}:items.${s.items.length}.`;
        }
        return handlers.current.onItem(id, action, n === undefined ? -1 : Number(n));
      }
      const link = element(e.target)?.closest('a[href^="/"]');
      if (link && !element(e.target)?.closest('[data-edit],[data-img]')) {
        const path = (link.getAttribute('href') ?? '/').split('#')[0]!;
        return handlers.current.onNavigate(path.replace(/^\/|\/$/g, ''));
      }
      const img = field('data-img', e.target);
      if (img?.id === '$theme') return handlers.current.onDesign();
      if (img) return handlers.current.onImage(img.id, img.path);
      if (element(e.target)?.closest('[data-biz]')) return handlers.current.onBusiness();
      // Clicking a text types in it (and shows the text toolbar); not the section window.
      if (element(e.target)?.closest('[data-edit]')) return;
      if (element(e.target)?.closest('nav.nav')) return handlers.current.onDesign();
      const id = sectionId(e.target);
      if (id) handlers.current.onSelect(id);
      else handlers.current.onDeselect();
    };
    const onInput = () => {
      const cur = editing.current;
      if (cur) handlers.current.onText(cur.id, cur.path, read(cur.el, cur.multi));
    };
    const onBeforeInput = (e: Event) => {
      const cur = editing.current;
      const ie = e as InputEvent;
      if (!cur || !ie.inputType.startsWith('insert')) return;
      const room = fieldLimit(cur.path) - read(cur.el, cur.multi).length;
      const adding = ie.data?.length ?? 1;
      if (room < adding) e.preventDefault();
    };
    const onPaste = (e: Event) => {
      if (!editing.current) return;
      // Plain text only, whatever was copied.
      e.preventDefault();
      const text = (e as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
      doc.execCommand(
        'insertText',
        false,
        editing.current.multi ? text : text.replace(/\s+/g, ' '),
      );
    };
    const onKey = (e: Event) => {
      const cur = editing.current;
      const k = (e as KeyboardEvent).key;
      if (!cur) return;
      if (k === 'Escape' || (k === 'Enter' && !cur.multi)) {
        e.preventDefault();
        cur.el.blur();
      }
    };
    const onBlur = (e: Event) => {
      const cur = editing.current;
      if (!cur || e.target !== cur.el) return;
      handlers.current.onText(cur.id, cur.path, read(cur.el, cur.multi).trim());
      cur.el.removeAttribute('contenteditable');
      editing.current = null;
      setTyping(null);
      setFrozen(null); // show the re-rendered page (scroll position is kept)
    };
    const onSubmit = (e: Event) => e.preventDefault();
    const onScroll = () => {
      scrollY.current = win?.scrollY ?? 0;
      setMenuFor(null);
      const cur = editing.current;
      if (cur) {
        const r = cur.el.getBoundingClientRect();
        setTyping({ id: cur.id, path: cur.path, top: r.top, bottom: r.bottom, left: r.left });
      }
      measure();
    };
    doc.addEventListener('mousedown', onDown, true);
    doc.addEventListener('mouseover', onOver);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('input', onInput);
    doc.addEventListener('beforeinput', onBeforeInput);
    doc.addEventListener('paste', onPaste);
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('focusout', onBlur);
    doc.addEventListener('submit', onSubmit, true);
    win?.addEventListener('scroll', onScroll, { passive: true });
    win?.addEventListener('resize', measure);
    // A list item was just added: start typing in its first field.
    if (pendingFocus.current) {
      const el = doc.querySelector<HTMLElement>(`[data-edit^="${pendingFocus.current}"]`);
      pendingFocus.current = null;
      if (el) {
        el.scrollIntoView({ block: 'center' });
        begin(field('data-edit', el));
        el.focus();
      }
    }
    return () => {
      doc.removeEventListener('mousedown', onDown, true);
      doc.removeEventListener('mouseover', onOver);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('input', onInput);
      doc.removeEventListener('beforeinput', onBeforeInput);
      doc.removeEventListener('paste', onPaste);
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('focusout', onBlur);
      doc.removeEventListener('submit', onSubmit, true);
      win?.removeEventListener('scroll', onScroll);
      win?.removeEventListener('resize', measure);
    };
  }, [doc, measure]);

  // Selecting a section from the side list brings it into view.
  useEffect(() => {
    if (!selected || !doc) return;
    const el = doc.getElementById(`s-${selected}`);
    const r = el?.getBoundingClientRect();
    const h = doc.defaultView?.innerHeight ?? 0;
    if (el && r && (r.top < 0 || r.top > h * 0.6)) el.scrollIntoView({ block: 'start' });
  }, [selected, doc]);

  const index = (id: string) => sections.findIndex((s) => s.id === id);
  const label = (id: string) => {
    const s = sections.find((x) => x.id === id);
    return s ? sectionTypeLabels[s.type] : '';
  };
  const hasImage = (id: string) => {
    const type = sections.find((x) => x.id === id)?.type;
    return type === 'hero' || type === 'about';
  };
  // An open insert menu wins over hover, so moving the mouse across the page to reach it
  // doesn't switch to another section and close it.
  const active = frozen ? null : (menuFor ?? hovered);
  // Near the bottom of the frame the section menu opens upwards so it isn't cut off.
  const menuUp =
    active && rects[active]
      ? rects[active].top + rects[active].height > (frame.current?.clientHeight ?? 0) - 240
      : false;
  const canAdd = sections.length < SITE_LIMITS.sections;

  return (
    <div
      className={cn(
        'mx-auto h-full overflow-hidden bg-white transition-[width] duration-300',
        device === 'mobile'
          ? 'w-[390px] max-w-full rounded-[2rem] border-[10px] border-ink shadow-lift'
          : 'w-full rounded-2xl border border-surface-border shadow-card',
      )}
    >
      <div
        className="relative h-full w-full overflow-hidden"
        onMouseLeave={() => {
          setHovered(null);
          setMenuFor(null);
        }}
      >
        <iframe
          ref={frame}
          title="תצוגה מקדימה של האתר"
          srcDoc={frozen ?? html}
          // Same-origin lets this page attach listeners and measure sections; no scripts run inside.
          sandbox="allow-same-origin"
          onLoad={onLoad}
          data-ready={loaded === (frozen ?? html)}
          className="h-full w-full border-0"
        />
        {selected && rects[selected] && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-[3px] border-brand-500"
            style={{ top: rects[selected].top, height: rects[selected].height }}
          />
        )}
        {inspector && !frozen && (
          <div
            role="dialog"
            aria-label={selected ? `הגדרות ${label(selected)}` : 'עיצוב האתר'}
            className="absolute end-3 z-20 hidden max-h-[calc(100%-1.5rem)] w-[22rem] overflow-y-auto rounded-xl border border-surface-border bg-surface p-4 shadow-lift lg:block"
            style={{
              top:
                selected && rects[selected]
                  ? Math.min(
                      Math.max(rects[selected]!.top + 12, 12),
                      Math.max(12, (frame.current?.clientHeight ?? 600) * 0.3),
                    )
                  : 72,
            }}
            onKeyDown={(e) => {
              // Ignore keys from dialogs opened inside it (they bubble through React portals).
              if (e.key === 'Escape' && e.currentTarget.contains(e.target as Node)) {
                handlers.current.onDeselect();
              }
            }}
          >
            {inspector}
          </div>
        )}
        {typing && textTools && (
          <div
            role="toolbar"
            aria-label="עיצוב הטקסט"
            // Keep the focus (and the caret) in the text while using the toolbar.
            onMouseDown={(e) => e.preventDefault()}
            className="absolute z-30 flex items-center gap-1 rounded-xl bg-ink/95 p-1 text-white shadow-lift"
            style={{
              top: typing.top > 52 ? typing.top - 46 : typing.bottom + 8,
              left: Math.max(typing.left, 8),
            }}
          >
            {textTools(typing.id, typing.path, () => editing.current?.el.blur())}
          </div>
        )}
        {active && rects[active] && (
          <>
            {active !== selected && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 border-2 border-dashed border-brand-400 bg-brand-500/5"
                style={{ top: rects[active].top, height: rects[active].height }}
              />
            )}
            <div
              role="toolbar"
              aria-label={`פעולות על ${label(active)}`}
              hidden={Boolean(inspector) && active === selected}
              onMouseEnter={() => setHovered(active)}
              className="absolute z-10 flex items-center gap-0.5 rounded-xl bg-ink/90 p-1 shadow-lift"
              style={{
                top: Math.max(rects[active].top, 0) + 10,
                // Beside the open settings window, never under it.
                insetInlineEnd: inspector ? '24rem' : '0.75rem',
              }}
            >
              <span className="px-2 text-xs font-medium text-white">{label(active)}</span>
              <button
                type="button"
                className={toolBtn}
                aria-label={`הגדרות ${label(active)}`}
                onClick={() => onSettings(active)}
              >
                <Settings2 aria-hidden className="h-4 w-4" />
              </button>
              {hasImage(active) && (
                <button
                  type="button"
                  className={toolBtn}
                  aria-label={`תמונה ל${label(active)}`}
                  onClick={() => onImage(active, 'imageAssetId')}
                >
                  <ImageIcon aria-hidden className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                className={toolBtn}
                aria-label={`הזזת ${label(active)} למעלה`}
                disabled={index(active) <= 0}
                onClick={() => onMove(active, -1)}
              >
                <ArrowUp aria-hidden className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={toolBtn}
                aria-label={`הזזת ${label(active)} למטה`}
                disabled={index(active) >= sections.length - 1}
                onClick={() => onMove(active, 1)}
              >
                <ArrowDown aria-hidden className="h-4 w-4" />
              </button>
              <button
                type="button"
                className={toolBtn}
                aria-label={`הסתרת ${label(active)}`}
                onClick={() => {
                  onHide(active);
                  setHovered(null);
                }}
              >
                <EyeOff aria-hidden className="h-4 w-4" />
              </button>
            </div>
            {canAdd && (
              <div
                className="absolute inset-x-0 z-10 flex justify-center"
                style={{ top: rects[active].top + rects[active].height - 18 }}
                onMouseEnter={() => setHovered(active)}
              >
                <div
                  className="relative"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setMenuFor(null);
                  }}
                >
                  <button
                    type="button"
                    aria-expanded={menuFor === active}
                    onClick={() => setMenuFor(menuFor === active ? null : active)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-lift hover:bg-brand-700"
                  >
                    <Plus aria-hidden className="h-4 w-4" />
                    הוספת מקטע כאן
                  </button>
                  {menuFor === active && (
                    <ul
                      aria-label="סוג המקטע להוספה"
                      className={cn(
                        'absolute start-1/2 grid w-64 grid-cols-2 gap-1 rounded-2xl border border-surface-border bg-surface p-2 shadow-lift rtl:translate-x-1/2 ltr:-translate-x-1/2',
                        menuUp ? 'bottom-full mb-2' : 'top-full mt-2',
                      )}
                    >
                      {SECTION_TYPES.filter((t) => t !== 'hero').map((t) => (
                        <li key={t}>
                          <button
                            type="button"
                            className="w-full rounded-lg px-2.5 py-2 text-start text-sm text-ink hover:bg-brand-50"
                            onClick={() => {
                              onInsert(active, t);
                              setMenuFor(null);
                            }}
                          >
                            {sectionTypeLabels[t]}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
