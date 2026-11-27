import { apiPaths, businessWebPaths, type Business } from '@simplecatch/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allFields } from '../../test/leadFields';
import { json, me, mockApi, renderApp, testBusiness, testUser } from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const meKey = `GET ${apiPaths.auth.me}`;
const section = (s: string) => businessWebPaths.section(id, s);
const asRole = (role: Business['role']) => ({
  [`GET ${apiPaths.businesses.detail(id)}`]: () =>
    json(200, { business: { ...testBusiness, role } }),
});
const topBar = () => screen.getByRole('banner', { name: 'סרגל עליון' });
const menuButton = async () =>
  within(await screen.findByRole('banner', { name: 'סרגל עליון' })).findByRole('button', {
    name: 'תפריט המשתמש: דנה כהן',
  });

describe('user menu (D-206)', () => {
  it('opens from the keyboard and moves with arrows, Home and End; Escape returns focus', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(section('tasks'));
    const button = await menuButton();
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    // The role stays under the name.
    expect(within(button).getByText('בעל/ת העסק')).toBeInTheDocument();

    button.focus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const menu = within(topBar()).getByRole('menu', { name: 'תפריט המשתמש' });
    const item = (name: string) => within(menu).getByRole('menuitem', { name });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['החשבון שלי', 'מנוי וחיוב', 'התנתקות']);
    await waitFor(() => expect(item('החשבון שלי')).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    expect(item('מנוי וחיוב')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('התנתקות')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('החשבון שלי')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(item('התנתקות')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('החשבון שלי')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');

    // Space opens too.
    await user.keyboard(' ');
    expect(within(topBar()).getByRole('menu')).toBeInTheDocument();
  });

  it('closes on a click outside', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(section('tasks'));
    await user.click(await menuButton());
    expect(within(topBar()).getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByRole('heading', { name: 'משימות', level: 1 }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('an owner opens Plan & billing, titled with the business name', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user, location } = renderApp(section('tasks'));
    await user.click(await menuButton());
    await user.click(within(topBar()).getByRole('menuitem', { name: 'מנוי וחיוב' }));
    expect(location()).toBe(section('billing'));
    expect(
      await screen.findByRole('heading', { name: 'מנוי וחיוב', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(testBusiness.name).length).toBeGreaterThan(0);
    expect(screen.getByText(/בחירת מסלול, אמצעי תשלום וחשבוניות/)).toBeInTheDocument();
  });

  it.each(['MANAGER', 'EMPLOYEE'] as const)(
    'a %s has no billing item, and the billing page says no permission',
    async (role) => {
      mockApi({ [meKey]: me(testUser), ...asRole(role) });
      const { user } = renderApp(section('billing'));
      expect(
        await screen.findByRole('heading', { name: 'אין לך הרשאה לצפות במנוי והחיוב' }),
      ).toBeInTheDocument();
      await user.click(await menuButton());
      const menu = within(topBar()).getByRole('menu');
      expect(
        within(menu)
          .getAllByRole('menuitem')
          .map((i) => i.textContent),
      ).toEqual(['החשבון שלי', 'התנתקות']);
    },
  );

  it('works inside the mobile drawer: Escape closes only the menu; a choice closes the drawer', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user, location } = renderApp(section('tasks'));
    await user.click(await screen.findByRole('button', { name: 'פתיחת תפריט' }));
    const drawer = await screen.findByRole('dialog', { name: 'תפריט ניווט' });
    const button = within(drawer).getByRole('button', { name: 'תפריט המשתמש: דנה כהן' });
    button.focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(within(drawer).getByRole('menuitem', { name: 'החשבון שלי' })).toHaveFocus(),
    );
    await user.keyboard('{Escape}');
    expect(within(drawer).queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'תפריט ניווט' })).toBeInTheDocument();

    await user.click(button);
    await user.click(within(drawer).getByRole('menuitem', { name: 'החשבון שלי' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(location()).toBe(section('account'));
  });
});

describe('old Settings links (D-206)', () => {
  it('?tab=billing goes to the billing page, ?tab=fields to the lead-fields page', async () => {
    mockApi({ [meKey]: me(testUser) });
    const billing = renderApp(`${section('settings')}?tab=billing`);
    await waitFor(() => expect(billing.location()).toBe(section('billing')));
    expect(
      await screen.findByRole('heading', { name: 'מנוי וחיוב', level: 1 }),
    ).toBeInTheDocument();
  });

  it('?tab=fields lands on Leads → Lead fields, with a way back to Leads', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { location } = renderApp(`${section('settings')}?tab=fields`);
    await waitFor(() => expect(location()).toBe(section('leads/fields')));
    expect(
      await screen.findByRole('heading', { name: 'שדות לידים', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'כל הלידים' })).toHaveAttribute(
      'href',
      section('leads'),
    );
  });
});

describe('lead fields from Leads (D-206)', () => {
  it.each(['OWNER', 'MANAGER'] as const)(
    'a %s finds "שדות לידים" in More and "ניהול שדות" in the filter panel',
    async (role) => {
      mockApi({
        [meKey]: me(testUser),
        ...asRole(role),
        [`GET ${apiPaths.leadFields.list(id)}`]: () => json(200, { fields: allFields }),
        [`GET ${apiPaths.businesses.members(id)}`]: () => json(200, { members: [] }),
      });
      const { user, location } = renderApp(section('leads'));
      await user.click(await screen.findByRole('button', { name: /סינון/ }));
      expect(screen.getByRole('link', { name: 'ניהול שדות' })).toHaveAttribute(
        'href',
        section('leads/fields'),
      );
      await user.click(screen.getByRole('button', { name: 'עוד' }));
      await user.click(screen.getByRole('link', { name: 'שדות לידים' }));
      expect(location()).toBe(section('leads/fields'));
      expect(await screen.findByRole('list', { name: 'שדות פעילים' })).toBeInTheDocument();
    },
  );

  it('an employee has neither, and the page shows no permission', async () => {
    mockApi({
      [meKey]: me(testUser),
      ...asRole('EMPLOYEE'),
      [`GET ${apiPaths.leadFields.list(id)}`]: () => json(200, { fields: allFields }),
    });
    const { user } = renderApp(section('leads'));
    await user.click(await screen.findByRole('button', { name: /סינון/ }));
    expect(screen.queryByRole('link', { name: 'ניהול שדות' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'עוד' }));
    expect(screen.queryByRole('link', { name: 'שדות לידים' })).not.toBeInTheDocument();
  });

  it('the lead-fields page shows no permission to an employee', async () => {
    mockApi({ [meKey]: me(testUser), ...asRole('EMPLOYEE') });
    renderApp(section('leads/fields'));
    expect(
      await screen.findByRole('heading', { name: 'אין לך הרשאה לצפות בשדות הלידים' }),
    ).toBeInTheDocument();
  });

  it('the command palette lists billing for owners only', async () => {
    mockApi({ [meKey]: me(testUser) });
    const { user } = renderApp(section('tasks'));
    await screen.findByRole('heading', { name: 'משימות', level: 1 });
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'מנוי');
    expect(await within(dialog).findByRole('option', { name: /מנוי וחיוב/ })).toBeInTheDocument();
  });

  it('the command palette has no billing for a manager', async () => {
    mockApi({ [meKey]: me(testUser), ...asRole('MANAGER') });
    const { user } = renderApp(section('tasks'));
    await screen.findByRole('heading', { name: 'משימות', level: 1 });
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'שדות');
    expect(await within(dialog).findByRole('option', { name: /שדות לידים/ })).toBeInTheDocument();
    await user.clear(within(dialog).getByRole('combobox'));
    await user.type(within(dialog).getByRole('combobox'), 'מנוי');
    expect(within(dialog).queryByRole('option', { name: /מנוי וחיוב/ })).not.toBeInTheDocument();
  });
});
