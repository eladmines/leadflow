import { apiPaths, businessWebPaths, type Lead } from '@leadflow/shared';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, me, mockApi, renderApp, testBusiness, testStages, testUser } from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const meKey = `GET ${apiPaths.auth.me}`;
const lead: Lead = {
  id: '5c000000-0000-4000-8000-000000000001',
  contact: {
    id: '5d000000-0000-4000-8000-000000000001',
    name: 'רון לוי',
    phone: '+972521112233',
    email: null,
  },
  stage: { id: testStages[0]!.id, name: testStages[0]!.name, kind: 'OPEN' },
  source: 'manual',
  sourceUrl: null,
  message: null,
  owner: null,
  expectedValue: null,
  nextActionAt: null,
  tags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('quick search (Ctrl+K)', () => {
  it('opens with the shortcut and jumps to a page with the keyboard', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user, location } = renderApp(businessWebPaths.home(id));
    await screen.findByRole('heading', { name: 'שלום, דנה' });
    await user.keyboard('{Control>}k{/Control}');
    const input = await screen.findByRole('combobox', { name: 'חיפוש עמודים, פעולות ולידים' });
    await user.type(input, 'משימות');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(location()).toBe(businessWebPaths.section(id, 'tasks')));
  });

  it('finds a lead by phone and opens it', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.leads.list(id)}`]: () => json(200, { leads: [lead] }),
      [`GET ${apiPaths.leads.detail(id, lead.id)}`]: () => json(200, { lead, activities: [] }),
    });
    const { user, location } = renderApp(businessWebPaths.home(id));
    await user.click((await screen.findAllByRole('button', { name: /חיפוש מהיר/ }))[0]!);
    await user.type(screen.getByRole('combobox'), '052111');
    expect(await screen.findByRole('option', { name: /רון לוי/ })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(location()).toBe(`${businessWebPaths.section(id, 'leads')}/${lead.id}`),
    );
  });

  it('"ליד חדש" opens the new-lead dialog on the leads page', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(businessWebPaths.home(id));
    await user.click((await screen.findAllByRole('button', { name: /חיפוש מהיר/ }))[0]!);
    await user.type(screen.getByRole('combobox'), 'ליד חדש');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'ליד חדש' })).toBeInTheDocument();
  });
});
