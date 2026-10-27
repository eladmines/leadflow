import { describe, expect, it } from 'vitest';
import { defaultOpeningHours } from './business';
import {
  saveDraftRequestSchema,
  sectionSchema,
  SECTION_TYPES,
  templateForIndustry,
  type Section,
} from './site';
import { renderSitePage } from './site-render';
import { buildTemplateDraft, newSection, type SiteBusinessInfo } from './site-templates';

const business: SiteBusinessInfo = {
  name: 'מספרת שירן',
  industry: 'beauty',
  phone: '+972501234567',
  address: 'הרצל 10, חיפה',
  serviceAreas: ['חיפה', 'יקנעם'],
  openingHours: defaultOpeningHours,
};

describe('templates', () => {
  it.each(['beauty', 'trades'] as const)('%s draft is valid against the save schema', (key) => {
    const draft = buildTemplateDraft(key, business);
    const parsed = saveDraftRequestSchema.safeParse({ revision: 0, ...draft });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(draft.sections[0]).toMatchObject({ type: 'hero', title: 'מספרת שירן' });
  });

  it('every section type has a valid empty starter', () => {
    for (const type of SECTION_TYPES) {
      expect(sectionSchema.safeParse(newSection(type, `new-${type}`)).success, type).toBe(true);
    }
  });

  it('suggests a template from the industry', () => {
    expect(templateForIndustry('beauty')).toBe('beauty');
    expect(templateForIndustry('studio')).toBe('beauty');
    expect(templateForIndustry('garage')).toBe('trades');
  });
});

describe('draft validation', () => {
  it('rejects duplicate section ids, unknown types and oversized text', () => {
    const draft = buildTemplateDraft('beauty', business);
    const dup = { ...draft, revision: 0, sections: [draft.sections[0], draft.sections[0]] };
    expect(saveDraftRequestSchema.safeParse(dup).success).toBe(false);
    const bad = { ...draft, revision: 0, sections: [{ id: 'x', type: 'script', visible: true }] };
    expect(saveDraftRequestSchema.safeParse(bad).success).toBe(false);
    const long = {
      ...draft,
      revision: 0,
      sections: [{ ...draft.sections[0], title: 'א'.repeat(121) }],
    };
    expect(saveDraftRequestSchema.safeParse(long).success).toBe(false);
  });
});

describe('renderSitePage', () => {
  it('renders an RTL Hebrew document with SEO, phone and hours', () => {
    const html = renderSitePage(buildTemplateDraft('beauty', business), business);
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain('<title>מספרת שירן</title>');
    expect(html).toContain('href="tel:+972501234567"');
    expect(html).toContain('050-1234567');
    expect(html).toContain('<caption>שעות פעילות</caption>');
    expect(html).not.toMatch(/<script/i);
  });

  it('escapes user text everywhere (no HTML or attribute injection)', () => {
    const evil = '"><script>alert(1)</script><img src=x onerror=alert(2)>';
    const sections: Section[] = [
      {
        id: 'h',
        type: 'hero',
        visible: true,
        title: evil,
        subtitle: evil,
        buttonLabel: evil,
        buttonAction: 'contact',
      },
      {
        id: 'f',
        type: 'faq',
        visible: true,
        title: evil,
        items: [{ question: evil, answer: evil }],
      },
      {
        id: 'c',
        type: 'contact',
        visible: true,
        title: evil,
        subtitle: '',
        showPhone: true,
        showAddress: true,
        showHours: false,
      },
    ];
    const html = renderSitePage(
      {
        theme: { palette: 'teal', font: 'rubik' },
        seo: { title: evil, description: evil },
        sections,
      },
      { ...business, name: evil, address: evil },
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain('"><script');
    expect(html).not.toContain('onerror=alert(2)>');
    expect(html).toContain('&lt;script&gt;');
    // The address only appears encoded inside the maps URL.
    expect(html).toContain(`query=${encodeURIComponent(evil)}`);
  });

  it('omits hidden sections and links the hero button to the contact section', () => {
    const draft = buildTemplateDraft('beauty', { ...business, phone: null });
    draft.sections = draft.sections.map((s) =>
      s.type === 'testimonials' ? { ...s, visible: false } : s,
    );
    const html = renderSitePage(draft, { ...business, phone: null });
    expect(html).not.toContain('מה הלקוחות מספרים');
    expect(html).toContain('href="#s-contact"');
    expect(html).not.toContain('tel:');
  });
});

describe('subdomain', () => {
  it('normalises and accepts valid names', async () => {
    const { subdomainSchema } = await import('./site');
    expect(subdomainSchema.parse('  Shiran-Salon ')).toBe('shiran-salon');
    expect(subdomainSchema.parse('abc')).toBe('abc');
  });

  it.each(['ab', '-shiran', 'shiran-', 'שירן', 'shi ran', 'a'.repeat(41), 'www', 'admin'])(
    'rejects %j',
    async (name) => {
      const { subdomainSchema } = await import('./site');
      expect(subdomainSchema.safeParse(name).success).toBe(false);
    },
  );
});
