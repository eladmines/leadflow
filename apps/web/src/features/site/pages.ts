import type { Section } from '@leadflow/shared';
import type { Draft } from './useDraftAutosave';

/** '' = the home page; otherwise an extra page's id (D-081). */
export type PageId = string;

/** The sections of one page. */
export const sectionsOf = (d: Draft, pageId: PageId) =>
  (pageId ? d.pages.find((p) => p.id === pageId)?.sections : undefined) ?? d.sections;

/** Changes the sections of one page. */
export const onPage = (d: Draft, pageId: PageId, fn: (s: Section[]) => Section[]): Draft =>
  pageId
    ? {
        ...d,
        pages: d.pages.map((p) => (p.id === pageId ? { ...p, sections: fn(p.sections) } : p)),
      }
    : { ...d, sections: fn(d.sections) };

/** Changes sections wherever they are (ids are unique across the site). */
export const onAllPages = (d: Draft, fn: (s: Section[]) => Section[]): Draft => ({
  ...d,
  sections: fn(d.sections),
  pages: d.pages.map((p) => ({ ...p, sections: fn(p.sections) })),
});
