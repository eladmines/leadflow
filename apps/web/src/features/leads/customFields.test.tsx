import {
  apiPaths,
  businessWebPaths,
  leadFieldMessages,
  type Business,
  type Lead,
  type LeadDetailResponse,
} from '@simplecatch/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allFields, eventTypeField, fieldIds, optionIds } from '../../test/leadFields';
import {
  apiError,
  callsTo,
  choose,
  json,
  me,
  mockApi,
  renderApp,
  testBusiness,
  testStages,
  testUser,
} from '../../test/utils';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

const id = testBusiness.id;
const lp = apiPaths.leads;
const meKey = `GET ${apiPaths.auth.me}`;
const fieldsKey = `GET ${apiPaths.leadFields.list(id)}`;
const leadsPath = businessWebPaths.section(id, 'leads');
const [newStage] = testStages;
const asRole = (role: Business['role']) => ({
  [`GET ${apiPaths.businesses.detail(id)}`]: () =>
    json(200, { business: { ...testBusiness, role } }),
});

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: '5c000000-0000-4000-8000-000000000001',
  contact: {
    id: '5d000000-0000-4000-8000-000000000001',
    name: 'נועה ברק',
    phone: '+972527654321',
    email: null,
  },
  stage: { id: newStage!.id, name: newStage!.name, kind: 'OPEN' },
  source: 'manual',
  sourceUrl: null,
  message: 'מחפשים אולם לחתונה',
  owner: null,
  expectedValue: null,
  nextActionAt: null,
  tags: [],
  customFields: {
    [fieldIds.car]: 'מאזדה 3',
    [fieldIds.guests]: 120,
    [fieldIds.eventType]: optionIds.conference,
    [fieldIds.parking]: true,
    [fieldIds.oldNote]: 'לקוח חוזר',
  },
  createdAt: new Date().toISOString(),
  updatedAt: '2026-11-27T10:00:00.000Z',
  ...over,
});
const detailPath = (l = lead()) => `${leadsPath}/${l.id}`;
const detail = (l = lead(), activities: LeadDetailResponse['activities'] = []) =>
  json(200, { lead: l, activities } satisfies LeadDetailResponse);

/** The leads list requests, as their query strings. */
const listQueries = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((u) => u.split('?')[0] === lp.list(id))
    .map((u) => new URLSearchParams(u.split('?')[1] ?? ''));

describe('lead card: Details block (F34)', () => {
  it('shows each active field by type and archived values read-only', async () => {
    mockApi({
      [meKey]: me(testUser),
      [fieldsKey]: () => json(200, { fields: allFields }),
      [`GET ${lp.detail(id, lead().id)}`]: () => detail(),
    });
    renderApp(detailPath());
    expect(await screen.findByRole('heading', { name: 'פרטים', level: 2 })).toBeInTheDocument();
    expect(await screen.findByLabelText('דגם הרכב')).toHaveValue('מאזדה 3');
    expect(screen.getByLabelText(/מספר אורחים/)).toHaveValue('120');
    expect(screen.getByText('ערך בין 1 ל־500')).toBeInTheDocument();
    expect(screen.getByLabelText('תאריך האירוע')).toHaveValue('');
    // A value whose option was removed keeps its label.
    expect(screen.getByRole('combobox', { name: 'סוג האירוע' })).toHaveTextContent('כנס (הוסרה)');
    expect(screen.getByRole('checkbox', { name: 'חנייה במקום' })).toBeChecked();
    // The archived field's value, read-only.
    const archived = screen.getByRole('region', { name: 'שדות בארכיון' });
    expect(within(archived).getByText('הערת מוקד')).toBeInTheDocument();
    expect(within(archived).getByText('לקוח חוזר')).toBeInTheDocument();
    expect(within(archived).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('saves each field on its own: text on leaving it, choice and checkbox at once', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [fieldsKey]: () => json(200, { fields: allFields }),
      [`GET ${lp.detail(id, lead().id)}`]: () => detail(),
      [`PATCH ${lp.detail(id, lead().id)}`]: () => json(200, { lead: lead() }),
    });
    const { user } = renderApp(detailPath());
    const car = await screen.findByLabelText('דגם הרכב');
    await user.clear(car);
    await user.type(car, 'טויוטה קורולה{Enter}');
    await choose(user, screen.getByRole('combobox', { name: 'סוג האירוע' }), 'חתונה');
    await user.click(screen.getByRole('checkbox', { name: 'חנייה במקום' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PATCH', lp.detail(id, lead().id))).toEqual([
        { customFields: { [fieldIds.car]: 'טויוטה קורולה' } },
        { customFields: { [fieldIds.eventType]: optionIds.wedding } },
        // Unticked = no value (D-204).
        { customFields: { [fieldIds.parking]: null } },
      ]),
    );
  });

  it('checks values like the server: a required field cannot be emptied, a range is kept', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [fieldsKey]: () => json(200, { fields: allFields }),
      [`GET ${lp.detail(id, lead().id)}`]: () => detail(),
      [`PATCH ${lp.detail(id, lead().id)}`]: () =>
        apiError(400, 'VALIDATION_ERROR', 'הנתונים אינם תקינים', {
          [`customFields.${fieldIds.car}`]: leadFieldMessages.valueTextTooLong,
        }),
    });
    const { user } = renderApp(detailPath());
    const guests = await screen.findByLabelText(/מספר אורחים/);
    await user.clear(guests);
    await user.tab();
    expect(await screen.findByText(leadFieldMessages.valueRequired)).toBeInTheDocument();
    await user.type(guests, '900');
    await user.tab();
    expect(await screen.findByText(leadFieldMessages.valueNumberMax(500))).toBeInTheDocument();
    expect(guests).toHaveAttribute('aria-invalid', 'true');
    expect(callsTo(fetchMock, 'PATCH', lp.detail(id, lead().id))).toHaveLength(0);

    // A refusal from the server lands on the field it names.
    const car = screen.getByLabelText('דגם הרכב');
    await user.type(car, ' ספורט');
    await user.tab();
    expect(await screen.findByText(leadFieldMessages.valueTextTooLong)).toBeInTheDocument();
    expect(car).toHaveAttribute('aria-invalid', 'true');
  });

  it('employees fill fields on leads they may update', async () => {
    mockApi({
      [meKey]: me(testUser),
      ...asRole('EMPLOYEE'),
      [fieldsKey]: () => json(200, { fields: allFields }),
      [`GET ${lp.detail(id, lead().id)}`]: () => detail(),
    });
    renderApp(detailPath());
    expect(await screen.findByLabelText('דגם הרכב')).toBeEnabled();
  });

  it('without fields, an employee sees no Details block', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      ...asRole('EMPLOYEE'),
      [`GET ${lp.detail(id, lead().id)}`]: () => detail(lead({ customFields: {} })),
    });
    renderApp(detailPath());
    await screen.findByRole('heading', { name: 'פרטי הטיפול' });
    await waitFor(() =>
      expect(callsTo(fetchMock, 'GET', apiPaths.leadFields.list(id))).toHaveLength(1),
    );
    // While the fields load, the block shows a spinner; with none defined it goes away.
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'פרטים' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText('טוענים את השדות…')).not.toBeInTheDocument();
  });

  it('a manager with no fields yet is pointed to the settings', async () => {
    mockApi({
      [meKey]: me(testUser),
      ...asRole('MANAGER'),
      [`GET ${lp.detail(id, lead().id)}`]: () => detail(lead({ customFields: {} })),
    });
    renderApp(detailPath());
    expect(await screen.findByRole('link', { name: 'להגדרת השדות' })).toHaveAttribute(
      'href',
      `${businessWebPaths.section(id, 'settings')}?tab=fields`,
    );
  });

  it('history shows custom field changes with labels, options and "Yes"', async () => {
    mockApi({
      [meKey]: me(testUser),
      [fieldsKey]: () => json(200, { fields: allFields }),
      [`GET ${lp.detail(id, lead().id)}`]: () =>
        detail(lead(), [
          {
            id: '7a000000-0000-4000-8000-000000000003',
            type: 'lead.updated',
            data: {
              fields: ['tags', 'customFields'],
              customFields: [
                { fieldId: fieldIds.eventType, from: optionIds.conference, to: optionIds.wedding },
                { fieldId: fieldIds.parking, from: null, to: true },
                { fieldId: fieldIds.guests, from: 80, to: null },
              ],
            },
            actor: { id: testUser.id, name: 'דנה כהן' },
            createdAt: new Date().toISOString(),
          },
        ]),
    });
    renderApp(`${detailPath()}?tab=notes`);
    const history = await screen.findByRole('list', { name: 'היסטוריית הליד' });
    expect(within(history).getByText('עודכנו: תגיות, שדות נוספים')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(history).getByText('סוג האירוע').closest('li')).toHaveTextContent(
        /סוג האירוע:\s*כנס←שונה לחתונה/,
      ),
    );
    expect(within(history).getByText('חנייה במקום').closest('li')).toHaveTextContent(/ריק.*כן/);
    expect(within(history).getByText('מספר אורחים').closest('li')).toHaveTextContent(/80.*ריק/);
  });
});

describe('new lead with custom fields (F34)', () => {
  it('marks required fields, blocks saving without them and sends the values', async () => {
    const created = lead({ id: '5c000000-0000-4000-8000-000000000009' });
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [fieldsKey]: () => json(200, { fields: allFields }),
      [`POST ${lp.list(id)}`]: () => json(201, { lead: created }),
      [`GET ${lp.detail(id, created.id)}`]: () => detail(created),
      [`GET ${lp.duplicates(id)}`]: () => json(200, { contacts: [] }),
      [`GET ${apiPaths.businesses.members(id)}`]: () => json(200, { members: [] }),
    });
    const { user } = renderApp(leadsPath);
    await user.click(await screen.findByRole('button', { name: 'ליד חדש' }));
    const dialog = await screen.findByRole('dialog', { name: 'ליד חדש' });
    const guests = await within(dialog).findByLabelText(/מספר אורחים/);
    expect(guests).toBeRequired();
    // Archived fields are not offered.
    expect(within(dialog).queryByLabelText('הערת מוקד')).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/^שם/), 'נועה ברק');
    await user.type(within(dialog).getByLabelText('טלפון'), '052-7654321');
    await user.click(within(dialog).getByRole('button', { name: 'יצירת ליד' }));
    expect(await within(dialog).findByText(leadFieldMessages.valueRequired)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', lp.list(id))).toHaveLength(0);

    await user.type(guests, '120');
    await choose(user, within(dialog).getByRole('combobox', { name: 'סוג האירוע' }), 'חתונה');
    // The removed option can't be chosen for a new lead.
    await user.click(within(dialog).getByRole('combobox', { name: 'סוג האירוע' }));
    expect(screen.queryByRole('option', { name: /כנס/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'חתונה' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'חנייה במקום' }));
    await user.click(within(dialog).getByRole('button', { name: 'יצירת ליד' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', lp.list(id))).toHaveLength(1));
    expect(callsTo(fetchMock, 'POST', lp.list(id))[0]).toMatchObject({
      name: 'נועה ברק',
      // The full dialog enforces required fields (D-205).
      skipRequiredCustomFields: false,
      customFields: {
        [fieldIds.guests]: 120,
        [fieldIds.eventType]: optionIds.wedding,
        [fieldIds.parking]: true,
      },
    });
  });

  it("puts the server's per-field error on that field", async () => {
    mockApi({
      [meKey]: me(testUser),
      [fieldsKey]: () => json(200, { fields: allFields }),
      [`POST ${lp.list(id)}`]: () =>
        apiError(400, 'VALIDATION_ERROR', 'הנתונים אינם תקינים', {
          [`customFields.${fieldIds.car}`]: leadFieldMessages.valueTextTooLong,
        }),
      [`GET ${lp.duplicates(id)}`]: () => json(200, { contacts: [] }),
      [`GET ${apiPaths.businesses.members(id)}`]: () => json(200, { members: [] }),
    });
    const { user } = renderApp(leadsPath);
    await user.click(await screen.findByRole('button', { name: 'ליד חדש' }));
    const dialog = await screen.findByRole('dialog', { name: 'ליד חדש' });
    await user.type(within(dialog).getByLabelText(/^שם/), 'נועה ברק');
    await user.type(within(dialog).getByLabelText('טלפון'), '052-7654321');
    await user.type(await within(dialog).findByLabelText(/מספר אורחים/), '50');
    await user.type(within(dialog).getByLabelText('דגם הרכב'), 'מאזדה');
    await user.click(within(dialog).getByRole('button', { name: 'יצירת ליד' }));
    expect(await within(dialog).findByText(leadFieldMessages.valueTextTooLong)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('דגם הרכב')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('leads list filters by custom fields (F34)', () => {
  it('filters by choice, checkbox, text and number range through the URL and the API', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [fieldsKey]: () => json(200, { fields: allFields }),
      [`GET ${lp.list(id)}`]: () => json(200, { leads: [lead()] }),
      [`GET ${apiPaths.businesses.members(id)}`]: () => json(200, { members: [] }),
    });
    const { user, location } = renderApp(`${leadsPath}?view=list`);
    await user.click(await screen.findByRole('button', { name: /סינון/ }));
    const panel = screen.getByRole('group', { name: 'סינון לפי שדות נוספים' });
    // Archived fields have no filter; a removed option can still be searched.
    expect(within(panel).queryByText('הערת מוקד')).not.toBeInTheDocument();

    await choose(user, within(panel).getByRole('combobox', { name: 'סוג האירוע' }), 'חתונה');
    await choose(user, within(panel).getByRole('combobox', { name: 'חנייה במקום' }), 'לא מסומן');
    await user.type(within(panel).getByLabelText('דגם הרכב'), 'מאזדה');
    await user.type(within(panel).getByLabelText('מספר אורחים: מ־'), '100{Enter}');
    await user.type(within(panel).getByLabelText('תאריך האירוע: עד'), '2026-12-31');

    await waitFor(() => {
      const last = listQueries(fetchMock).at(-1)!;
      expect(last.get(`cf[${fieldIds.eventType}]`)).toBe(optionIds.wedding);
      expect(last.get(`cf[${fieldIds.parking}]`)).toBe('false');
      expect(last.get(`cf[${fieldIds.car}]`)).toBe('מאזדה');
      expect(last.get(`cf[${fieldIds.guests}][from]`)).toBe('100');
      expect(last.get(`cf[${fieldIds.eventDate}][to]`)).toBe('2026-12-31');
    });
    const url = new URLSearchParams(location()!.split('?')[1]);
    expect(url.get(`cf[${fieldIds.eventType}]`)).toBe(optionIds.wedding);
    expect(url.get(`cf[${fieldIds.guests}][from]`)).toBe('100');

    // One click clears them all.
    await user.click(screen.getByRole('button', { name: 'ניקוי הסינון' }));
    await waitFor(() => expect(location()).not.toContain('cf'));
  });

  it('drops filters for archived or unknown fields before calling the API', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [fieldsKey]: () => json(200, { fields: allFields }),
      [`GET ${lp.list(id)}`]: () => json(200, { leads: [lead()] }),
      [`GET ${apiPaths.businesses.members(id)}`]: () => json(200, { members: [] }),
    });
    const stale = new URLSearchParams({
      view: 'list',
      [`cf[${fieldIds.oldNote}]`]: 'חוזר',
      ['cf[f9999999-0000-4000-8000-000000000000]']: 'x',
      [`cf[${fieldIds.guests}]`]: '5', // a number takes from/to, not a value
      [`cf[${fieldIds.car}]`]: 'מאזדה',
    });
    renderApp(`${leadsPath}?${stale}`);
    expect(await screen.findByText('1 פניות')).toBeInTheDocument();
    const queries = listQueries(fetchMock);
    // No request went out before the fields were known, and none with a stale filter.
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect([...q.keys()].filter((k) => k.startsWith('cf['))).toEqual([`cf[${fieldIds.car}]`]);
    }
  });

  it('shows up to two chosen fields on the cards, remembered in this browser', async () => {
    mockApi({
      [meKey]: me(testUser),
      [fieldsKey]: () => json(200, { fields: allFields }),
      [`GET ${lp.list(id)}`]: () => json(200, { leads: [lead()] }),
      [`GET ${apiPaths.businesses.members(id)}`]: () => json(200, { members: [] }),
    });
    const { user } = renderApp(`${leadsPath}?view=list`);
    await user.click(await screen.findByRole('button', { name: /סינון/ }));
    await choose(user, screen.getByRole('combobox', { name: 'שדה בכרטיסים' }), 'מספר אורחים');
    const card = screen.getAllByRole('article')[0]!;
    expect(within(card).getByText('מספר אורחים')).toBeInTheDocument();
    expect(within(card).getByText('120')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(`simplecatch.leadCardFields.${id}`)!)).toEqual([
      fieldIds.guests,
    ]);
  });
});

describe('long labels never widen the page (QA-F34-04)', () => {
  // The longest a field label (40) and an option label (60) may be.
  const longField = 'שם שדה ארוך מאוד שמגיע בדיוק לארבעים תו!'.slice(0, 40);
  const longOption = 'אפשרות ארוכה מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד מאוד!!'.slice(0, 60);
  const field = {
    ...eventTypeField,
    label: longField,
    options: [
      { id: optionIds.wedding, label: longOption, archivedAt: null },
      { id: optionIds.barMitzvah, label: 'קצר', archivedAt: null },
    ],
  };

  it('the chosen option is cut short in the control, with the full text kept', async () => {
    mockApi({
      [meKey]: me(testUser),
      [fieldsKey]: () => json(200, { fields: [field] }),
      [`GET ${lp.detail(id, lead().id)}`]: () =>
        detail(lead({ customFields: { [fieldIds.eventType]: optionIds.wedding } })),
    });
    renderApp(detailPath());
    const control = await screen.findByRole('combobox', { name: longField });
    // The text is all there (screen readers read it); it is shown on one line with an ellipsis
    // and the whole of it in the tooltip.
    expect(control).toHaveTextContent(longOption);
    const value = within(control).getByText(longOption);
    expect(value).toHaveAttribute('title', longOption);
    expect(value).toHaveClass('truncate', 'min-w-0');
    expect(control).toHaveClass('min-w-0');
    // The control and the side column may shrink below their text's width.
    expect(control.closest('.relative.flex')).toHaveClass('min-w-0', 'max-w-full');
    const column = screen.getByRole('heading', { name: 'פרטים' }).closest('.lg\\:order-first');
    expect(column).toHaveClass('min-w-0');
    expect(column?.parentElement).toHaveClass('grid-cols-1');
  });

  it('long labels wrap in the list cards and are cut short, with a tooltip, in Settings', async () => {
    mockApi({
      [meKey]: me(testUser),
      [fieldsKey]: () => json(200, { fields: [field] }),
      [`GET ${lp.list(id)}`]: () =>
        json(200, { leads: [lead({ customFields: { [fieldIds.eventType]: optionIds.wedding } })] }),
    });
    localStorage.setItem(`simplecatch.leadCardFields.${id}`, JSON.stringify([fieldIds.eventType]));
    renderApp(`${leadsPath}?view=list`);
    const card = (await screen.findAllByRole('article'))[0]!;
    const value = within(card).getByText(longOption);
    expect(value.closest('dd')).toHaveClass('min-w-0', '[overflow-wrap:anywhere]');
  });

  it('a long field name in the Settings list is truncated with the full name as a tooltip', async () => {
    mockApi({ [meKey]: me(testUser), [fieldsKey]: () => json(200, { fields: [field] }) });
    renderApp(`${businessWebPaths.section(id, 'settings')}?tab=fields`);
    const name = await within(await screen.findByRole('list', { name: 'שדות פעילים' })).findByText(
      longField,
    );
    expect(name).toHaveAttribute('title', longField);
    expect(name).toHaveClass('block', 'truncate');
  });
});

describe('invalid characters (NUL, lone surrogates)', () => {
  it('a text value with them is refused on the lead card, in the app language, without saving', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [fieldsKey]: () => json(200, { fields: allFields }),
      [`GET ${lp.detail(id, lead().id)}`]: () => detail(),
    });
    renderApp(detailPath());
    const car = await screen.findByLabelText('דגם הרכב');
    fireEvent.change(car, { target: { value: 'מאזדה\u0000' } });
    fireEvent.blur(car);
    expect(await screen.findByText(leadFieldMessages.invalidCharacters)).toBeInTheDocument();
    expect(car).toHaveAttribute('aria-invalid', 'true');
    expect(callsTo(fetchMock, 'PATCH', lp.detail(id, lead().id))).toHaveLength(0);
  });

  it('a field name or option with them is refused in Settings', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [fieldsKey]: () => json(200, { fields: [] }),
    });
    const { user } = renderApp(`${businessWebPaths.section(id, 'settings')}?tab=fields`);
    await user.click(await screen.findByRole('button', { name: 'הוספת שדה' }));
    const dialog = await screen.findByRole('dialog', { name: 'שדה חדש' });
    fireEvent.change(within(dialog).getByLabelText(/שם השדה/), {
      target: { value: 'אזור\uD800' },
    });
    await choose(user, within(dialog).getByLabelText(/סוג השדה/), 'בחירה מרשימה');
    fireEvent.change(within(dialog).getByLabelText('אפשרות 1'), {
      target: { value: 'צפון\u0000' },
    });
    await user.type(within(dialog).getByLabelText('אפשרות 2'), 'דרום');
    await user.click(within(dialog).getByRole('button', { name: 'הוספת השדה' }));
    expect(await within(dialog).findAllByText(leadFieldMessages.invalidCharacters)).toHaveLength(2);
    expect(callsTo(fetchMock, 'POST', apiPaths.leadFields.list(id))).toHaveLength(0);
  });

  it('shows the English text in English', async () => {
    const { setLocaleForTests, tr } = await import('../../i18n');
    setLocaleForTests('en');
    try {
      expect(tr(leadFieldMessages.invalidCharacters)).toBe(
        'The text contains invalid characters. Delete them and try again.',
      );
    } finally {
      setLocaleForTests('he');
    }
  });
});
