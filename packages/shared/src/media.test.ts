import { describe, expect, it } from 'vitest';
import { referencedAssetIds } from './media';
import { saveDraftRequestSchema, type Section } from './site';
import { renderSitePage, type MediaMap } from './site-render';
import { buildTemplateDraft, newSection, type SiteBusinessInfo } from './site-templates';

const b: SiteBusinessInfo = {
  name: 'מספרת שירן',
  industry: 'beauty',
  phone: null,
  address: null,
  serviceAreas: [],
  openingHours: null,
};
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const media: MediaMap = {
  [A]: { url: '/media/a.webp', width: 400, height: 200 },
  [B]: { url: '/media/b.webp', width: 1200, height: 800 },
};

describe('images in the site', () => {
  it('drafts saved before images existed still parse (defaults)', () => {
    const old = buildTemplateDraft('beauty', b);
    const legacy = JSON.parse(JSON.stringify(old)) as Record<string, unknown> & {
      theme: object;
      sections: object[];
    };
    delete (legacy.theme as Record<string, unknown>).logoAssetId;
    for (const s of legacy.sections as Array<Record<string, unknown>>) {
      delete s.imageAssetId;
      delete s.imageAlt;
    }
    const parsed = saveDraftRequestSchema.parse({ ...legacy, revision: 0 });
    expect(parsed.theme.logoAssetId).toBeNull();
    expect(parsed.sections[0]).toMatchObject({ type: 'hero', imageAssetId: null });
  });

  it('renders the logo, hero background, about image with alt text, and a gallery', () => {
    const draft = buildTemplateDraft('beauty', b);
    draft.theme.logoAssetId = A;
    const hero = draft.sections.find((s) => s.type === 'hero') as Extract<
      Section,
      { type: 'hero' }
    >;
    hero.imageAssetId = B;
    const about = draft.sections.find((s) => s.type === 'about') as Extract<
      Section,
      { type: 'about' }
    >;
    about.imageAssetId = B;
    about.imageAlt = 'הסלון שלנו';
    const gallery = newSection('gallery', 'gal') as Extract<Section, { type: 'gallery' }>;
    gallery.items = [
      { assetId: B, caption: '<b>לפני</b>' },
      { assetId: C, caption: 'missing asset' },
    ];
    draft.sections.push(gallery);

    const html = renderSitePage(draft, b, media);
    expect(html).toContain('<img class="logo" src="/media/a.webp" alt="מספרת שירן"');
    expect(html).toContain('class="hero has-img"');
    expect(html).toContain('<img class="hero-bg" src="/media/b.webp" alt=""');
    expect(html).toContain('alt="הסלון שלנו"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('&lt;b&gt;לפני&lt;/b&gt;');
    expect(html).not.toContain('missing asset'); // unknown/foreign assets are skipped
    expect(referencedAssetIds(draft).sort()).toEqual([A, B, C].sort());
  });

  it('renders nothing for an empty gallery and ignores images without a map entry', () => {
    const draft = buildTemplateDraft('beauty', b);
    draft.theme.logoAssetId = C;
    draft.sections.push(newSection('gallery', 'gal'));
    const html = renderSitePage(draft, b, media);
    expect(html).not.toContain('class="logo"');
    expect(html).not.toContain('id="s-gal"');
  });
});
