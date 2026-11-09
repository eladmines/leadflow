import { describe, expect, it } from 'vitest';
import { attributionFromMetaReferral, attributionName, classifyAttribution } from './attribution';

const visit = (params: Record<string, string>, referrer?: string) =>
  classifyAttribution({ params, referrer, selfHost: 'salon.lvh.me:4100', landingPath: '/about' });

describe('classifyAttribution (F26)', () => {
  it('names ads by click id or tagged link', () => {
    expect(visit({ gclid: 'abc', utm_campaign: 'summer', utm_term: 'hairdresser' })).toMatchObject({
      source: 'google_ads',
      clickIdType: 'gclid',
      campaign: 'summer',
      term: 'hairdresser',
      landingPath: '/about',
    });
    expect(visit({ utm_source: 'google', utm_medium: 'cpc' }).source).toBe('google_ads');
    expect(visit({ utm_source: 'facebook', utm_medium: 'paid' }).source).toBe('meta_ads');
    expect(visit({ fbclid: 'x' }).source).toBe('meta');
    expect(visit({ ttclid: 'x' }).source).toBe('tiktok');
    expect(visit({ msclkid: 'x' }).source).toBe('microsoft_ads');
    const news = visit({ utm_source: 'Newsletter' });
    expect(news.source).toBe('utm');
    expect(attributionName(news)).toBe('Newsletter');
  });

  it('names organic, other sites and direct visits', () => {
    expect(visit({}, 'https://www.google.co.il/').source).toBe('google');
    expect(visit({}, 'https://l.facebook.com/').source).toBe('meta');
    const other = visit({}, 'https://www.example.org/page');
    expect(other).toMatchObject({ source: 'referral', referrerHost: 'www.example.org' });
    expect(attributionName(other)).toBe('example.org');
    expect(visit({}).source).toBe('direct');
    // The site's own pages aren't a source.
    expect(visit({}, 'http://salon.lvh.me:4100/').source).toBe('direct');
  });

  it('never keeps the click id value', () => {
    expect(JSON.stringify(visit({ gclid: 'SECRET-CLICK-ID' }))).not.toContain('SECRET-CLICK-ID');
  });

  it('reads Meta ad referrals; other referrals are not ads', () => {
    expect(
      attributionFromMetaReferral({
        source_type: 'ad',
        source_id: '120200',
        headline: 'Haircut 20% off',
        ctwa_clid: 'ARxx',
      }),
    ).toMatchObject({
      source: 'meta_ads',
      adId: '120200',
      adHeadline: 'Haircut 20% off',
      clickIdType: 'ctwa',
    });
    expect(attributionFromMetaReferral({ source_type: 'post', source_id: '99' })).toBeNull();
  });
});
