import {
  SECTION_TYPES,
  sectionTypeLabels,
  SITE_LIMITS,
  type Section,
  type SectionType,
} from '@leadflow/shared';
import { ArrowDown, ArrowUp, EyeOff, Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

/** Sections are direct children of <main> with id `s-<sectionId>` (see renderSitePage). */
const SECTION_SELECTOR = 'main > [id^="s-"]';

interface Rect {
  top: number;
  height: number;
}

const toolBtn =
  'flex h-8 w-8 items-center justify-center rounded-lg text-white hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-transparent';

/**
 * The editor preview with in-page editing (step 1 of visual editing): hover a section to see a
 * toolbar (edit, move, hide) and a "+" to insert a section after it; click a section to open its
 * form. The page itself still runs no scripts: the iframe allows same-origin access only, and all
 * listeners and the toolbar live in this (parent) document. Links and forms are inert here.
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
}: {
  html: string;
  device: 'desktop' | 'mobile';
  sections: Section[];
  selected: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onHide: (id: string) => void;
  onInsert: (afterId: string, type: SectionType) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const scrollY = useRef(0);
  const [doc, setDoc] = useState<Document | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [menuFor, setMenuFor] = useState<string | null>(null);

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
    d.defaultView?.scrollTo({ top: scrollY.current, behavior: 'instant' });
    setDoc(d);
    measure();
  };

  useEffect(() => {
    if (!doc) return;
    const win = doc.defaultView;
    const sectionId = (t: EventTarget | null) =>
      (t instanceof doc.defaultView!.Element ? t.closest(SECTION_SELECTOR)?.id.slice(2) : null) ??
      null;
    const onOver = (e: Event) => setHovered(sectionId(e.target));
    const onClick = (e: Event) => {
      e.preventDefault(); // links (tel:, anchors) and the lead form are inert in the editor
      const id = sectionId(e.target);
      if (id) onSelect(id);
    };
    const onSubmit = (e: Event) => e.preventDefault();
    const onScroll = () => {
      scrollY.current = win?.scrollY ?? 0;
      setMenuFor(null);
      measure();
    };
    doc.addEventListener('mouseover', onOver);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('submit', onSubmit, true);
    win?.addEventListener('scroll', onScroll, { passive: true });
    win?.addEventListener('resize', measure);
    return () => {
      doc.removeEventListener('mouseover', onOver);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('submit', onSubmit, true);
      win?.removeEventListener('scroll', onScroll);
      win?.removeEventListener('resize', measure);
    };
  }, [doc, measure, onSelect]);

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
  const active = hovered ?? menuFor;
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
          srcDoc={html}
          // Same-origin lets this page attach listeners and measure sections; no scripts run inside.
          sandbox="allow-same-origin"
          onLoad={onLoad}
          className="h-full w-full border-0"
        />
        {selected && rects[selected] && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-[3px] border-brand-500"
            style={{ top: rects[selected].top, height: rects[selected].height }}
          />
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
              onMouseEnter={() => setHovered(active)}
              className="absolute end-3 z-10 flex items-center gap-0.5 rounded-xl bg-ink/90 p-1 shadow-lift"
              style={{ top: Math.max(rects[active].top, 0) + 10 }}
            >
              <span className="px-2 text-xs font-medium text-white">{label(active)}</span>
              <button
                type="button"
                className={toolBtn}
                aria-label={`עריכת ${label(active)}`}
                onClick={() => onSelect(active)}
              >
                <Pencil aria-hidden className="h-4 w-4" />
              </button>
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
                <div className="relative">
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
