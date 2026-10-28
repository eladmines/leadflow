import { SITE_LIMITS, type Section } from '@leadflow/shared';

/**
 * Writes one field of a section by its editor path (`title`, `items.2.name`), as produced by the
 * renderer's editor markers (D-071). Unknown paths leave the section unchanged.
 */
export function setSectionField(section: Section, path: string, value: string): Section {
  const [key, index, field] = path.split('.');
  if (!key || !(key in section)) return section;
  if (index === undefined) return { ...section, [key]: value } as Section;
  if (key !== 'items' || !('items' in section) || !field) return section;
  const n = Number(index);
  const items = section.items as Record<string, unknown>[];
  if (!Number.isInteger(n) || !items[n] || !(field in items[n]!)) return section;
  return {
    ...section,
    items: items.map((it, i) => (i === n ? { ...it, [field]: value } : it)),
  } as Section;
}

/** Max length per field, mirroring the shared schema, so inline typing never fails to save. */
export function fieldLimit(path: string): number {
  const field = path.split('.').at(-1);
  switch (field) {
    case 'body':
      return SITE_LIMITS.body;
    case 'title':
    case 'name':
    case 'question':
      return SITE_LIMITS.title;
    case 'price':
    case 'buttonLabel':
      return SITE_LIMITS.price;
    case 'author':
      return 80;
    case 'caption':
      return 160;
    default:
      return SITE_LIMITS.shortText;
  }
}
