import {
  apiPaths,
  businessWebPaths,
  leadFieldMessages,
  type Business,
  type LeadFieldDefinition,
} from '@simplecatch/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  allFields,
  carField,
  eventTypeField,
  fieldIds,
  guestsField,
  oldNoteField,
  optionIds,
} from '../../test/leadFields';
import {
  apiError,
  callsTo,
  choose,
  json,
  me,
  mockApi,
  renderApp,
  testBusiness,
  testUser,
} from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const lf = apiPaths.leadFields;
const meKey = `GET ${apiPaths.auth.me}`;
const page = `${businessWebPaths.section(id, 'settings')}?tab=fields`;
const asRole = (role: Business['role']) => ({
  [`GET ${apiPaths.businesses.detail(id)}`]: () =>
    json(200, { business: { ...testBusiness, role } }),
});
const list = (fields: LeadFieldDefinition[]) => () => json(200, { fields });
const newId = 'f1000000-0000-4000-8000-0000000000aa';

describe('Settings → Lead fields (F34)', () => {
  it('lists active fields in order and archived ones apart, for an owner', async () => {
    mockApi({ [meKey]: me(testUser), [`GET ${lf.list(id)}`]: list(allFields) });
    renderApp(page);
    const active = await screen.findByRole('list', { name: 'שדות פעילים' });
    const rows = within(active).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('bdi')?.textContent)).toEqual([
      'דגם הרכב',
      'מספר אורחים',
      'תאריך האירוע',
      'סוג האירוע',
      'חנייה במקום',
    ]);
    // Type, required, range and the number of active options under each name.
    expect(within(rows[1]!).getByText('מספר · חובה · ערך בין 1 ל־500')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('בחירה מרשימה · אפשרויות: 2')).toBeInTheDocument();
    expect(screen.getByText('5 מתוך 20 שדות פעילים')).toBeInTheDocument();
    const archived = screen.getByRole('list', { name: 'שדות בארכיון' });
    expect(within(archived).getByText('הערת מוקד')).toBeInTheDocument();
    // Labels are the business's text: isolated, never translated.
    expect(within(rows[0]!).getByText('דגם הרכב').tagName).toBe('BDI');
  });

  it('a manager manages fields too (no "owner only" notice on this tab)', async () => {
    mockApi({ [meKey]: me(testUser), ...asRole('MANAGER'), [`GET ${lf.list(id)}`]: list([]) });
    renderApp(page);
    expect(await screen.findByText('עדיין אין שדות משלכם')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'הוספת שדה' })).toBeEnabled();
    expect(screen.queryByText(/רק בעל\/ת העסק יכול\/ה לשנות/)).not.toBeInTheDocument();
  });

  it('an employee gets the no-permission state and nothing is loaded', async () => {
    const fetchMock = mockApi({ [meKey]: me(testUser), ...asRole('EMPLOYEE') });
    renderApp(page);
    expect(
      await screen.findByRole('heading', { name: 'אין לך הרשאה לצפות בשדות הלידים' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'הוספת שדה' })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, 'GET', lf.list(id))).toHaveLength(0);
  });

  it('shows an error with a retry when the fields fail to load', async () => {
    let fail = true;
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lf.list(id)}`]: () =>
        fail
          ? apiError(500, 'INTERNAL_ERROR', 'אירעה שגיאה. נסו שוב')
          : json(200, { fields: [carField] }),
    });
    const { user } = renderApp(page);
    expect(await screen.findByText('לא הצלחנו לטעון את השדות')).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'לנסות שוב' }));
    expect(await screen.findByRole('list', { name: 'שדות פעילים' })).toBeInTheDocument();
  });

  it('adds a choice field with its options', async () => {
    let fields: LeadFieldDefinition[] = [];
    const created: LeadFieldDefinition = {
      ...eventTypeField,
      id: newId,
      label: 'אזור',
      position: 0,
      options: [
        { id: 'opt-north', label: 'צפון', archivedAt: null },
        { id: 'opt-center', label: 'מרכז', archivedAt: null },
      ],
    };
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${lf.list(id)}`]: () => json(200, { fields }),
      [`POST ${lf.list(id)}`]: () => {
        fields = [created];
        return json(201, { field: created });
      },
    });
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('button', { name: 'הוספת שדה' }));
    const dialog = await screen.findByRole('dialog', { name: 'שדה חדש' });
    await user.type(within(dialog).getByLabelText(/שם השדה/), 'אזור');
    await choose(user, within(dialog).getByLabelText(/סוג השדה/), 'בחירה מרשימה');
    await user.type(within(dialog).getByLabelText('אפשרות 1'), 'צפון');
    await user.type(within(dialog).getByLabelText('אפשרות 2'), 'דרום');
    // Enter in the last option adds another one and moves to it.
    await user.keyboard('{Enter}');
    expect(within(dialog).getByLabelText('אפשרות 3')).toHaveFocus();
    await user.keyboard('מרכז');
    await user.click(within(dialog).getByRole('button', { name: 'הסרת אפשרות 2' }));
    await user.click(within(dialog).getByRole('button', { name: 'הוספת השדה' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', lf.list(id))).toEqual([
        {
          label: 'אזור',
          type: 'select',
          options: [{ label: 'צפון' }, { label: 'מרכז' }],
          required: false,
          min: null,
          max: null,
        },
      ]),
    );
    expect(await screen.findByRole('list', { name: 'שדות פעילים' })).toHaveTextContent('אזור');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('checks the form before sending: label, options, range; a checkbox cannot be required', async () => {
    const fetchMock = mockApi({ [meKey]: me(testUser), [`GET ${lf.list(id)}`]: list([]) });
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('button', { name: 'הוספת שדה' }));
    const dialog = await screen.findByRole('dialog', { name: 'שדה חדש' });
    await user.click(within(dialog).getByRole('button', { name: 'הוספת השדה' }));
    expect(await within(dialog).findByText(leadFieldMessages.labelRequired)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/שם השדה/), 'אורחים');
    await choose(user, within(dialog).getByLabelText(/סוג השדה/), 'מספר');
    await user.type(within(dialog).getByLabelText('ערך מינימלי'), '100');
    await user.type(within(dialog).getByLabelText('ערך מקסימלי'), '10');
    await user.click(within(dialog).getByRole('button', { name: 'הוספת השדה' }));
    expect(await within(dialog).findByText(leadFieldMessages.rangeInvalid)).toBeInTheDocument();

    await choose(user, within(dialog).getByLabelText(/סוג השדה/), 'בחירה מרשימה');
    await user.type(within(dialog).getByLabelText('אפשרות 1'), 'כן');
    await user.type(within(dialog).getByLabelText('אפשרות 2'), 'כן');
    await user.click(within(dialog).getByRole('button', { name: 'הוספת השדה' }));
    expect(await within(dialog).findByText(leadFieldMessages.optionDuplicate)).toBeInTheDocument();

    await choose(user, within(dialog).getByLabelText(/סוג השדה/), 'תיבת סימון');
    expect(within(dialog).queryByLabelText('שדה חובה')).not.toBeInTheDocument();
    expect(within(dialog).getByText(leadFieldMessages.booleanNotRequired)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', lf.list(id))).toHaveLength(0);
  });

  it("shows the server's Hebrew messages: a taken label inline, the 20-field limit above", async () => {
    let answer = () =>
      apiError(409, 'CONFLICT', leadFieldMessages.labelTaken, {
        label: leadFieldMessages.labelTaken,
      });
    mockApi({
      [meKey]: me(testUser),
      [`GET ${lf.list(id)}`]: list([carField]),
      [`POST ${lf.list(id)}`]: () => answer(),
    });
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('button', { name: 'הוספת שדה' }));
    const dialog = await screen.findByRole('dialog', { name: 'שדה חדש' });
    await user.type(within(dialog).getByLabelText(/שם השדה/), 'דגם הרכב');
    await user.click(within(dialog).getByRole('button', { name: 'הוספת השדה' }));
    const label = within(dialog).getByLabelText(/שם השדה/);
    await waitFor(() => expect(label).toHaveAttribute('aria-invalid', 'true'));
    expect(within(dialog).getByText(leadFieldMessages.labelTaken)).toBeInTheDocument();

    answer = () => apiError(409, 'CONFLICT', leadFieldMessages.tooManyFields);
    await user.clear(label);
    await user.type(label, 'צבע');
    await user.click(within(dialog).getByRole('button', { name: 'הוספת השדה' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      leadFieldMessages.tooManyFields,
    );
  });

  it('reorders with the arrow buttons, keeping focus on the moved field', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${lf.list(id)}`]: list([carField, guestsField]),
      [`PUT ${lf.order(id)}`]: () =>
        json(200, {
          fields: [
            { ...guestsField, position: 0 },
            { ...carField, position: 1 },
          ],
        }),
    });
    const { user } = renderApp(page);
    const down = await screen.findByRole('button', { name: 'הזזת דגם הרכב למטה' });
    expect(screen.getByRole('button', { name: 'הזזת דגם הרכב למעלה' })).toBeDisabled();
    down.focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PUT', lf.order(id))).toEqual([
        { ids: [fieldIds.guests, fieldIds.car] },
      ]),
    );
    const rows = within(screen.getByRole('list', { name: 'שדות פעילים' })).getAllByRole('listitem');
    expect(rows[1]).toHaveTextContent('דגם הרכב');
    // Now last: its "down" is off, so focus is on its "up".
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'הזזת דגם הרכב למעלה' })).toHaveFocus(),
    );
    expect(await screen.findByText('השדה דגם הרכב הועבר למקום 2')).toBeInTheDocument();
  });

  it('edits a choice field: rename, remove an option (archived), type stays', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${lf.list(id)}`]: list([eventTypeField]),
      [`PATCH ${lf.detail(id, fieldIds.eventType)}`]: () =>
        json(200, { field: { ...eventTypeField, label: 'סוג האירוע המבוקש' } }),
    });
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('button', { name: 'עריכת סוג האירוע' }));
    const dialog = await screen.findByRole('dialog', { name: 'עריכת שדה' });
    expect(within(dialog).getByText(leadFieldMessages.typeLocked)).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: /סוג השדה/ })).not.toBeInTheDocument();
    // An option removed earlier can be brought back.
    expect(within(dialog).getByRole('button', { name: 'החזרת האפשרות כנס' })).toBeInTheDocument();

    const label = within(dialog).getByLabelText(/שם השדה/);
    await user.clear(label);
    await user.type(label, 'סוג האירוע המבוקש');
    await user.type(within(dialog).getByLabelText('אפשרות 1'), ' גדולה');
    await user.click(within(dialog).getByRole('button', { name: 'הסרת אפשרות 2' }));
    await user.click(within(dialog).getByRole('button', { name: 'הוספת אפשרות' }));
    await user.keyboard('ברית');
    await user.click(within(dialog).getByRole('button', { name: 'שמירת השדה' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PATCH', lf.detail(id, fieldIds.eventType))).toEqual([
        {
          label: 'סוג האירוע המבוקש',
          options: [{ id: optionIds.wedding, label: 'חתונה גדולה' }, { label: 'ברית' }],
        },
      ]),
    );
  });

  it('archives after confirming, and restores; a restore over the limit explains why', async () => {
    let fields: LeadFieldDefinition[] = [carField, oldNoteField];
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`GET ${lf.list(id)}`]: () => json(200, { fields }),
      [`PATCH ${lf.detail(id, fieldIds.car)}`]: () => {
        fields = [oldNoteField, { ...carField, archivedAt: '2026-11-27T10:00:00.000Z' }];
        return json(200, { field: fields[1] });
      },
      [`PATCH ${lf.detail(id, fieldIds.oldNote)}`]: () =>
        apiError(409, 'CONFLICT', leadFieldMessages.tooManyFields),
    });
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('button', { name: 'העברת דגם הרכב לארכיון' }));
    const confirm = await screen.findByRole('dialog', { name: 'להעביר את "דגם הרכב" לארכיון?' });
    await user.click(within(confirm).getByRole('button', { name: 'העברה לארכיון' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PATCH', lf.detail(id, fieldIds.car))).toEqual([
        { archived: true },
      ]),
    );
    const archived = await screen.findByRole('list', { name: 'שדות בארכיון' });
    await waitFor(() => expect(archived).toHaveTextContent('דגם הרכב'));

    await user.click(within(archived).getByRole('button', { name: 'שחזור הערת מוקד' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(leadFieldMessages.tooManyFields);
    expect(callsTo(fetchMock, 'PATCH', lf.detail(id, fieldIds.oldNote))).toEqual([
      { archived: false },
    ]);
  });
});
