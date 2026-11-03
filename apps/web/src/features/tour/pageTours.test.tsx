import { apiPaths, businessWebPaths } from '@leadflow/shared';
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
    const first = await screen.findByRole('dialog', { name: 'ליד חדש' });
    // Owner sees the export button, so every leads step applies.
    expect(within(first).getByText(/^1 מתוך \d+$/)).toBeInTheDocument();
    await user.click(within(first).getByRole('button', { name: 'הבא' }));
    expect(await screen.findByRole('dialog', { name: 'חיפוש וסינון' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it("skips steps for things that aren't on the page", async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.whatsapp.inbox(id)}`]: () => json(200, { connected: false, numbers: [] }),
      [`GET ${apiPaths.whatsapp.personal(id)}`]: () => json(200, { numbers: [] }),
    });
    const { user } = renderApp(section('conversations'));
    await screen.findByText('WhatsApp עדיין לא מחובר');
    await openPageTour(user);
    // Nothing to classify and no personal numbers: only the introduction is left.
    const only = await screen.findByRole('dialog', { name: 'שיחות WhatsApp' });
    expect(within(only).getByText('1 מתוך 1')).toBeInTheDocument();
    await user.click(within(only).getByRole('button', { name: 'סיום' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
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
  it('says hello once per browser', async () => {
    localStorage.removeItem('leadflow.helper.greeted');
    mockApi({ [meKey]: me(testUser) });
    renderApp(section('leads'));
    expect(
      await screen.findByText(/אני העוזר של LeadFlow 👋/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(localStorage.getItem('leadflow.helper.greeted')).toBeNull();
    cleanup();
    localStorage.setItem('leadflow.helper.greeted', '1');
    renderApp(section('leads'));
    await screen.findByRole('button', { name: 'עזרה' });
    await new Promise((r) => setTimeout(r, 1700));
    expect(screen.queryByText(/אני העוזר של LeadFlow 👋/)).not.toBeInTheDocument();
  });
});
