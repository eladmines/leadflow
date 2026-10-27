import { apiPaths, businessWebPaths, type Lead, type LeadDetailResponse } from '@leadflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  callsTo,
  json,
  me,
  mockApi,
  renderApp,
  testBusiness,
  testStages,
  testUser,
} from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const lp = apiPaths.leads;
const meKey = `GET ${apiPaths.auth.me}`;
const leadsPath = businessWebPaths.section(id, 'leads');
const [newStage, contacted] = testStages;
const lead = (over: Partial<Lead> = {}): Lead => ({
  id: '5c000000-0000-4000-8000-000000000001',
  contact: {
    id: '5d000000-0000-4000-8000-000000000001',
    name: 'דנה כהן',
    phone: '+972527654321',
    email: null,
  },
  stage: { id: newStage!.id, name: newStage!.name, kind: 'OPEN' },
  source: 'website_form',
  sourceUrl: null,
  message: 'אשמח לתור',
  owner: null,
  expectedValue: 1500,
  nextActionAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...over,
});
const members = {
  [`GET ${apiPaths.businesses.members(id)}`]: () =>
    json(200, {
      members: [
        {
          userId: testUser.id,
          fullName: 'דנה כהן',
          email: testUser.email,
          role: 'OWNER',
          joinedAt: testUser.createdAt,
        },
        {
          userId: '6e000000-0000-4000-8000-000000000001',
          fullName: 'יוסי מזרחי',
          email: 'yossi@example.com',
          role: 'EMPLOYEE',
          joinedAt: testUser.createdAt,
        },
      ],
    }),
};

describe('pipeline board', () => {
  it('groups leads by stage with counts and value totals', async () => {
    mockApi({
      [meKey]: me(testUser),
      ...members,
      [`GET ${lp.list(id)}`]: () =>
        json(200, {
          leads: [lead(), lead({ id: '5c000000-0000-4000-8000-000000000002', expectedValue: 500 })],
        }),
    });
    renderApp(leadsPath);
    const board = await screen.findByRole('list', { name: 'לוח לידים' });
    const column = within(board).getByRole('listitem', { name: 'חדש: 2 לידים' });
    expect(within(column).getAllByRole('article')).toHaveLength(2);
    expect(within(column).getByText(/2,000/)).toBeInTheDocument();
    expect(within(board).getByRole('listitem', { name: 'נוצר קשר: 0 לידים' })).toBeInTheDocument();
  });

  it('moves a lead with the keyboard-friendly stage menu (optimistic, then saved)', async () => {
    let current = lead();
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...members,
      [`GET ${lp.list(id)}`]: () => json(200, { leads: [current] }),
      [`PATCH ${lp.detail(id, lead().id)}`]: () => {
        current = lead({ stage: { id: contacted!.id, name: contacted!.name, kind: 'OPEN' } });
        return json(200, { lead: current });
      },
    });
    const { user } = renderApp(leadsPath);
    await user.selectOptions(await screen.findByLabelText('העברת דנה כהן לשלב'), contacted!.id);
    const board = screen.getByRole('list', { name: 'לוח לידים' });
    expect(
      await within(within(board).getByRole('listitem', { name: /^נוצר קשר/ })).findByText(
        'דנה כהן',
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PATCH', lp.detail(id, lead().id))).toEqual([
        { stageId: contacted!.id },
      ]),
    );
  });

  it('rolls the move back and explains when the server refuses', async () => {
    mockApi({
      [meKey]: me(testUser),
      ...members,
      [`GET ${lp.list(id)}`]: () => json(200, { leads: [lead()] }),
      [`PATCH ${lp.detail(id, lead().id)}`]: () =>
        apiError(403, 'FORBIDDEN', 'אין לך הרשאה לבצע פעולה זו'),
    });
    const { user } = renderApp(leadsPath);
    await user.selectOptions(await screen.findByLabelText('העברת דנה כהן לשלב'), contacted!.id);
    expect(await screen.findByText('אין לך הרשאה לבצע פעולה זו')).toBeInTheDocument();
    const board = screen.getByRole('list', { name: 'לוח לידים' });
    await waitFor(() =>
      expect(
        within(within(board).getByRole('listitem', { name: /^חדש/ })).getByText('דנה כהן'),
      ).toBeInTheDocument(),
    );
  });

  it('search goes into the URL and the API query', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...members,
      [`GET ${lp.list(id)}`]: () => json(200, { leads: [lead()] }),
      [`GET ${lp.list(id)}?q=%D7%93%D7%A0%D7%94`]: () => json(200, { leads: [lead()] }),
    });
    const { user, location } = renderApp(leadsPath);
    await user.type(await screen.findByLabelText('חיפוש לידים'), 'דנה');
    await waitFor(() => expect(location()).toBe(`${leadsPath}?q=%D7%93%D7%A0%D7%94`));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('?q='))).toBe(true),
    );
  });
});

describe('new lead', () => {
  it('warns about an existing contact, creates the lead and opens it', async () => {
    const created = lead({ id: '5c000000-0000-4000-8000-000000000009', source: 'manual' });
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...members,
      [`GET ${lp.duplicates(id)}?phone=%2B972527654321`]: () =>
        json(200, {
          contacts: [
            {
              id: created.contact.id,
              name: 'דנה כהן',
              phone: '+972527654321',
              email: null,
              leadCount: 2,
            },
          ],
        }),
      [`POST ${lp.list(id)}`]: () => json(201, { lead: created }),
      [`GET ${lp.detail(id, created.id)}`]: () =>
        json(200, { lead: created, activities: [] } satisfies LeadDetailResponse),
    });
    const { user, location } = renderApp(leadsPath);
    await user.click(await screen.findByRole('button', { name: 'ליד חדש' }));
    const dialog = await screen.findByRole('dialog', { name: 'ליד חדש' });
    await user.click(within(dialog).getByRole('button', { name: 'יצירת ליד' }));
    expect(await within(dialog).findByText('יש להזין טלפון או אימייל')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/^שם/), 'דנה כהן');
    await user.type(within(dialog).getByLabelText('טלפון'), '052-7654321');
    expect(await within(dialog).findByText('כבר קיים איש קשר עם הפרטים האלה')).toBeInTheDocument();
    expect(within(dialog).getByText(/2 פניות/)).toBeInTheDocument();

    await user.selectOptions(
      within(dialog).getByLabelText('אחראי'),
      '6e000000-0000-4000-8000-000000000001',
    );
    await user.click(within(dialog).getByRole('button', { name: 'יצירת ליד' }));
    await waitFor(() => expect(location()).toBe(`${leadsPath}/${created.id}`));
    expect(callsTo(fetchMock, 'POST', lp.list(id))[0]).toMatchObject({
      name: 'דנה כהן',
      phone: '+972527654321',
      ownerId: '6e000000-0000-4000-8000-000000000001',
    });
  });
});

describe('lead page', () => {
  const detail: LeadDetailResponse = {
    lead: lead(),
    activities: [
      {
        id: '7a000000-0000-4000-8000-000000000002',
        type: 'lead.stage_changed',
        data: { from: 'חדש', to: 'נוצר קשר' },
        actor: { id: testUser.id, name: 'דנה כהן' },
        createdAt: new Date().toISOString(),
      },
      {
        id: '7a000000-0000-4000-8000-000000000001',
        type: 'lead.created',
        data: { source: 'website_form' },
        actor: null,
        createdAt: new Date().toISOString(),
      },
    ],
  };

  it('shows contact, history, and saves stage, owner and a note', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...members,
      [`GET ${lp.detail(id, lead().id)}`]: () => json(200, detail),
      [`PATCH ${lp.detail(id, lead().id)}`]: () => json(200, { lead: lead() }),
      [`POST ${lp.notes(id, lead().id)}`]: () => json(201, { activity: detail.activities[0] }),
    });
    const { user } = renderApp(`${leadsPath}/${lead().id}`);
    expect(await screen.findByRole('heading', { name: 'דנה כהן', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /052-7654321/ })).toHaveAttribute(
      'href',
      'tel:+972527654321',
    );
    const history = screen.getByRole('list', { name: 'היסטוריית הליד' });
    expect(within(history).getByText('השלב שונה מ"חדש" ל"נוצר קשר"')).toBeInTheDocument();
    expect(within(history).getByText('הליד נוצר מטופס באתר')).toBeInTheDocument();

    await screen.findByRole('option', { name: 'נוצר קשר' });
    await screen.findByRole('option', { name: 'יוסי מזרחי' });
    await user.selectOptions(screen.getByLabelText('שלב'), contacted!.id);
    await user.selectOptions(
      screen.getByLabelText('אחראי'),
      '6e000000-0000-4000-8000-000000000001',
    );
    await user.type(screen.getByLabelText('הוספת הערה'), 'דיברנו בטלפון');
    await user.click(screen.getByRole('button', { name: 'שמירת הערה' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', lp.notes(id, lead().id))).toEqual([
        { text: 'דיברנו בטלפון' },
      ]),
    );
    expect(callsTo(fetchMock, 'PATCH', lp.detail(id, lead().id))).toEqual([
      { stageId: contacted!.id },
      { ownerId: '6e000000-0000-4000-8000-000000000001' },
    ]);
  });

  it('employees cannot reassign (plain text instead of a menu)', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${apiPaths.businesses.detail(id)}`]: () =>
        json(200, { business: { ...testBusiness, role: 'EMPLOYEE' } }),
      [`GET ${lp.detail(id, lead().id)}`]: () =>
        json(200, { ...detail, lead: lead({ owner: { id: testUser.id, name: 'דנה כהן' } }) }),
    });
    renderApp(`${leadsPath}/${lead().id}`);
    expect(await screen.findByRole('heading', { name: 'דנה כהן', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'אחראי' })).not.toBeInTheDocument();
  });

  it('shows "not found" for a lead outside the user\'s view (API 404)', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lp.detail(id, lead().id)}`]: () => apiError(404, 'NOT_FOUND', 'לא נמצא'),
    });
    renderApp(`${leadsPath}/${lead().id}`);
    expect(await screen.findByRole('heading', { name: 'הליד לא נמצא' })).toBeInTheDocument();
  });
});
