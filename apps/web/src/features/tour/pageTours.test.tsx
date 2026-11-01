import { apiPaths, businessWebPaths } from '@leadflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, me, mockApi, renderApp, testBusiness, testUser } from '../../test/utils';
import { pageKeyFor } from './pageTours';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const meKey = `GET ${apiPaths.auth.me}`;
const section = (s: string) => businessWebPaths.section(id, s);

describe('page tours (D-096)', () => {
  it('maps each screen to its tour', () => {
    expect(pageKeyFor(`/b/${id}`)).toBe('dashboard');
    expect(pageKeyFor(`/b/${id}/leads`)).toBe('leads');
    expect(pageKeyFor(`/b/${id}/leads/123`)).toBe('lead');
    expect(pageKeyFor(`/b/${id}/site`)).toBe('site');
    expect(pageKeyFor(`/b/${id}/quotes`)).toBe('quotes');
    expect(pageKeyFor(`/b/${id}/quotes/123`)).toBeNull();
    expect(pageKeyFor(`/b/${id}/settings`)).toBeNull();
  });

  it('runs the leads page tour from "סיור בעמוד"', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(section('leads'));
    await user.click(await screen.findByRole('button', { name: 'סיור בעמוד' }));
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
    await user.click(screen.getByRole('button', { name: 'סיור בעמוד' }));
    // Nothing to classify and no personal numbers: only the introduction is left.
    const only = await screen.findByRole('dialog', { name: 'שיחות WhatsApp' });
    expect(within(only).getByText('1 מתוך 1')).toBeInTheDocument();
    await user.click(within(only).getByRole('button', { name: 'סיום' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('the dashboard has its own tour', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(businessWebPaths.home(id));
    await user.click(await screen.findByRole('button', { name: 'סיור בעמוד' }));
    expect(await screen.findByRole('dialog', { name: 'הדשבורד' })).toBeInTheDocument();
  });

  it('screens without a tour show no button', async () => {
    mockApi({ [meKey]: me(testUser) });
    renderApp(section('settings'));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'סיור בעמוד' })).not.toBeInTheDocument();
  });
});
