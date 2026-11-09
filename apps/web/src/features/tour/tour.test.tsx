import { apiPaths, businessWebPaths, type Business } from '@leadflow/shared';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, me, mockApi, renderApp, testBusiness, testUser } from '../../test/utils';
import { TOUR_OFF_KEY, tourSteps } from './ProductTour';

afterEach(() => vi.unstubAllGlobals());
// This file covers the tour itself, so let it open.
beforeEach(() => localStorage.removeItem(TOUR_OFF_KEY));

const home = businessWebPaths.home(testBusiness.id);
const meKey = `GET ${apiPaths.auth.me}`;
const tourDialog = () => screen.findByRole('dialog', { name: 'ברוכים הבאים ל-LeadFlow' });

describe('product tour', () => {
  it('opens on first entry and walks through the steps with a counter', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(home);
    const dialog = await tourDialog();
    const total = tourSteps('OWNER').length;
    expect(within(dialog).getByText(`1 מתוך ${total}`)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'יאללה, מתחילים' })).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'יאללה, מתחילים' }));
    expect(await screen.findByRole('dialog', { name: 'דשבורד' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'הבא' }));
    expect(await screen.findByRole('dialog', { name: 'האתר שלי' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'הקודם' }));
    expect(await screen.findByRole('dialog', { name: 'דשבורד' })).toBeInTheDocument();

    // Arrow keys (RTL: left = forward).
    await user.keyboard('{ArrowLeft}');
    expect(await screen.findByRole('dialog', { name: 'האתר שלי' })).toBeInTheDocument();

    for (let i = 3; i < total; i++) await user.click(screen.getByRole('button', { name: 'הבא' }));
    const last = await screen.findByRole('dialog', { name: 'זהו, אפשר להתחיל!' });
    expect(within(last).getByText(`${total} מתוך ${total}`)).toBeInTheDocument();
    await user.click(within(last).getByRole('button', { name: 'סיום' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('skipping remembers it for this user, and the help menu replays it', async () => {
    mockApi({ [meKey]: me(testUser) });
    const first = renderApp(home);
    await first.user.click(within(await tourDialog()).getByRole('button', { name: 'דילוג' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    cleanup();

    const again = renderApp(home);
    await screen.findByRole('heading', { name: /(בוקר טוב|צהריים טובים|ערב טוב), דנה/ });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await again.user.click(screen.getByRole('button', { name: 'עזרה' }));
    await again.user.click(screen.getByRole('menuitem', { name: 'סיור במערכת' }));
    expect(await tourDialog()).toBeInTheDocument();
    await again.user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows each role only the screens it can open', () => {
    const titles = (role: Business['role']) => tourSteps(role).map((s) => s.title);
    expect(titles('OWNER')).toEqual(expect.arrayContaining(['שיחות', 'דוחות']));
    expect(titles('MANAGER')).toEqual(expect.arrayContaining(['שיחות', 'דוחות']));
    expect(titles('EMPLOYEE')).not.toContain('שיחות');
    expect(titles('EMPLOYEE')).not.toContain('דוחות');
    expect(titles('EMPLOYEE')).toContain('לידים');
  });

  it('does not open for a business still in onboarding', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.businesses.detail(testBusiness.id)}`]: () =>
        json(200, { business: { ...testBusiness, status: 'ONBOARDING', role: 'MANAGER' } }),
    });
    renderApp(home);
    await screen.findByRole('heading', { name: /בוקר טוב|צהריים טובים|ערב טוב/ });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
