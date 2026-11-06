import {
  apiPaths,
  AUTO_REPLY_DEFAULT,
  botDefaultTextsFor,
  businessWebPaths,
  STATUS_PRESETS,
} from '@leadflow/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, me, mockApi, renderApp, testBusiness, testUser } from '../../test/utils';
import { pageKeyFor } from './pageTours';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const meKey = `GET ${apiPaths.auth.me}`;
const section = (s: string) => businessWebPaths.section(id, s);

/** Help button → "סיור בעמוד" (D-104). */
async function openPageTour(user: ReturnType<typeof renderApp>['user']) {
  await user.click(await screen.findByRole('button', { name: 'עזרה' }));
  await user.click(screen.getByRole('menuitem', { name: 'סיור בעמוד' }));
}

describe('page tours (D-096)', () => {
  it('maps each screen to its tour', () => {
    expect(pageKeyFor(`/b/${id}`)).toBe('dashboard');
    expect(pageKeyFor(`/b/${id}/leads`)).toBe('leads');
    expect(pageKeyFor(`/b/${id}/leads/123`)).toBe('lead');
    expect(pageKeyFor(`/b/${id}/site`)).toBe('site');
    expect(pageKeyFor(`/b/${id}/quotes`)).toBe('quotes');
    expect(pageKeyFor(`/b/${id}/quotes/123`)).toBe('quote');
    expect(pageKeyFor(`/b/${id}/settings`)).toBe('settings');
    expect(pageKeyFor(`/b/${id}/account`)).toBe('account');
    expect(pageKeyFor(`/b/${id}/automations`)).toBeNull();
  });

  it('runs the leads page tour from the help menu', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(section('leads'));
    await openPageTour(user);
    const first = await screen.findByRole('dialog', { name: 'לקוחות ולידים' });
    // Owner sees the export button, so every leads step applies.
    expect(within(first).getByText(/^1 מתוך \d+$/)).toBeInTheDocument();
    await user.click(within(first).getByRole('button', { name: 'הבא' }));
    expect(await screen.findByRole('dialog', { name: 'ליד חדש' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'הבא' }));
    expect(await screen.findByRole('dialog', { name: 'רענון' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'הבא' }));
    expect(await screen.findByRole('dialog', { name: 'חיפוש וסינון' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it("explains every part of the conversations page, skipping what isn't there", async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.whatsapp.inbox(id)}`]: () => json(200, { connected: false, numbers: [] }),
      [`GET ${apiPaths.whatsapp.personal(id)}`]: () => json(200, { numbers: [] }),
      [`GET ${apiPaths.whatsapp.bot(id)}`]: () =>
        json(200, {
          connected: false,
          settings: {
            mode: 'booking',
            autoReplyText: null,
            autoReplyDefault: AUTO_REPLY_DEFAULT,
            statuses: STATUS_PRESETS.map((p) => ({ ...p, preset: true, video: null })),
            activeStatus: null,
            videoBytesUsed: 0,
            enabled: true,
            autoConfirm: true,
            holdDate: false,
            flow: 'appointment',
            flowIsDefault: true,
            defaults: botDefaultTextsFor('beauty'),
            texts: {},
            showcase: { enabled: false, defaultText: 'x', link: null, assetIds: [] },
          },
        }),
    });
    const { user } = renderApp(section('conversations'));
    await screen.findByText('WhatsApp עדיין לא מחובר');
    await screen.findByRole('heading', { name: 'בוט קביעת תורים' });
    await openPageTour(user);
    // Nothing to classify and no personal numbers: those steps are skipped.
    const titles: string[] = [];
    for (;;) {
      const step = await screen.findByRole('dialog');
      titles.push(within(step).getByRole('heading').textContent ?? '');
      const next = within(step).queryByRole('button', { name: 'הבא' });
      if (!next) break;
      await user.click(next);
    }
    expect(titles).toEqual([
      'שיחות WhatsApp',
      'רענון',
      'מענה אוטומטי',
      'הסטטוס שלך עכשיו',
      'מה קורה כשלקוח כותב',
      'שמירת ההגדרות',
      'בוט קביעת התורים',
      'איך לקוחות מזמינים',
      'אישור התורים',
      'שמירת הגדרות הבוט',
      'ההודעות של הבוט',
      'בינתיים, הצצה לעבודות שלנו',
    ]);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'סיום' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('the appointments tour starts with the calendar and its free times', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(`${section('appointments')}?date=2030-01-06`);
    await screen.findByRole('grid');
    await openPageTour(user);
    expect(await screen.findByRole('dialog', { name: 'היומן' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'הבא' }));
    expect(await screen.findByRole('dialog', { name: 'שעה פנויה' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'הבא' }));
    expect(await screen.findByRole('dialog', { name: 'מה כל צבע אומר' })).toBeInTheDocument();
  });

  it('the dashboard has its own tour', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(businessWebPaths.home(id));
    await openPageTour(user);
    expect(await screen.findByRole('dialog', { name: 'הדשבורד' })).toBeInTheDocument();
  });

  it('runs the settings tour over its sections', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(section('settings'));
    await openPageTour(user);
    const first = await screen.findByRole('dialog', { name: 'פרטי העסק' });
    expect(within(first).getByText('1 מתוך 4')).toBeInTheDocument();
  });

  it('screens without a tour leave it out of the help menu', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(section('automations'));
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: 'עזרה' }));
    const menu = screen.getByRole('menu', { name: 'היי, אני העוזר של LeadFlow' });
    expect(within(menu).queryByRole('menuitem', { name: 'סיור בעמוד' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'סיור במערכת' })).toBeInTheDocument();
  });

  it('the dashboard marks WhatsApp as connected when it is', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.whatsapp.inbox(id)}`]: () => json(200, { connected: true, numbers: [] }),
    });
    renderApp(businessWebPaths.home(id));
    expect(await screen.findByText('מחובר: הודעות מוואטסאפ נכנסות כלידים')).toBeInTheDocument();
  });
});

describe('help button (D-104)', () => {
  it('opens with the keyboard, moves with the arrows and closes with Escape', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(section('leads'));
    const help = await screen.findByRole('button', { name: 'עזרה' });
    help.focus();
    await user.keyboard('{ArrowDown}');
    const menu = screen.getByRole('menu', { name: 'היי, אני העוזר של LeadFlow' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'סיור בעמוד',
      'סיור במערכת',
      expect.stringMatching(/^חיפוש מהיר/),
    ]);
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(items[2]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'חיפוש מהיר' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(help);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(help).toHaveFocus();
  });

  it('is on the site editor too, with its page tour', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(section('site'));
    await user.click(await screen.findByRole('button', { name: 'עזרה' }));
    expect(screen.getByRole('menuitem', { name: 'סיור בעמוד' })).toBeInTheDocument();
  });
});

describe('help character (D-105)', () => {
  const hello = /אני העוזר של LeadFlow, ואני כאן כדי לעזור לך/;

  it('greets the person by name by itself, until closed with X (once per visit)', async () => {
    localStorage.removeItem('leadflow.helper.quiet');
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(section('leads'));
    const bubble = (await screen.findByText(hello, undefined, { timeout: 3000 })).closest(
      '[role="status"]',
    ) as HTMLElement;
    expect(
      within(bubble).getByText(`היי ${testUser.fullName.split(' ')[0]}! 👋`),
    ).toBeInTheDocument();
    expect(within(bubble).getByText(hello)).toBeInTheDocument();
    // It stays (no auto-hide) until closed.
    await new Promise((r) => setTimeout(r, 300));
    await user.click(within(bubble).getByRole('button', { name: 'סגירה' }));
    expect(screen.queryByText(hello)).not.toBeInTheDocument();

    // Same visit: not again.
    cleanup();
    renderApp(section('leads'));
    await screen.findByRole('button', { name: 'עזרה' });
    await new Promise((r) => setTimeout(r, 1700));
    expect(screen.queryByText(hello)).not.toBeInTheDocument();
  });

  it('"don\'t show again" keeps it quiet in later visits too', async () => {
    localStorage.removeItem('leadflow.helper.quiet');
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(section('leads'));
    await user.click(
      await screen.findByRole('button', { name: 'לא להציג שוב' }, { timeout: 3000 }),
    );
    expect(localStorage.getItem('leadflow.helper.quiet')).toBe('1');
    expect(screen.queryByText(hello)).not.toBeInTheDocument();
  });
});
