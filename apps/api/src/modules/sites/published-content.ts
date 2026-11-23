import { z } from 'zod';
import { sectionSchema, themeSchema } from '@simplecatch/shared';

/** What a published version stores (its `content` column): the site as it was published. */
export const publishedContent = z.object({
  theme: themeSchema,
  sections: z.array(sectionSchema),
  pages: z.array(z.object({ slug: z.string(), sections: z.array(sectionSchema) })).catch([]),
  business: z.object({ name: z.string() }),
});

/**
 * Every section of a published site in page order: its id, its page path and its name (the type:
 * `services`; `services-2` for a repeat on the same page). Reports and the counting script use these
 * names, so a client can never invent one (F32).
 */
export function sectionMap(content: unknown): { id: string; path: string; name: string }[] {
  const parsed = publishedContent.safeParse(content);
  if (!parsed.success) return [];
  const out: { id: string; path: string; name: string }[] = [];
  const pages = [
    { path: '/', list: parsed.data.sections },
    ...parsed.data.pages.map((p) => ({ path: `/${p.slug}`, list: p.sections })),
  ];
  for (const page of pages) {
    const seen = new Map<string, number>();
    for (const sec of page.list) {
      const n = (seen.get(sec.type) ?? 0) + 1;
      seen.set(sec.type, n);
      out.push({ id: sec.id, path: page.path, name: n > 1 ? `${sec.type}-${n}` : sec.type });
    }
  }
  return out;
}
