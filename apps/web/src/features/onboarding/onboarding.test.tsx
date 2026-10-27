import { apiPaths, businessWebPaths, type Business } from '@leadflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiError,
  callsTo,
  json,
  me,
  mockApi,
  noContent,
  renderApp,
  testBusiness,
  testUser,
} from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const bp = apiPaths.businesses;
const meKey = `GET ${apiPaths.auth.me}`;
const draft: Business = {
  ...testBusiness,
  status: 'ONBOARDING',
  onboardingStep: 2,
  phone: null,
  address: null,
  serviceAreas: [],
  openingHours: null,
};
const detailKey = `GET ${bp.detail(draft.id)}`;
const patchKey = `PATCH ${bp.detail(draft.id)}`;
/** PATCH handler that echoes the change back onto the draft, like the API. */
const patchEcho = (body: unknown) => {
  const { onboardingStep, ...rest } = body as Partial<Business>;
  return json(200, {
    business: { ...draft, ...rest, onboardingStep: onboardingStep ?? draft.onboardingStep },
  });
};

describe('onboarding wizard', () => {
  it('sends a user without a business from /app to step 1', async () => {
    mockApi({ [meKey]: me(testUser), [`GET ${bp.list}`]: () => json(200, { businesses: [] }) });
    const { location } = renderApp('/app');
    expect(
      await screen.findByRole('heading', { name: 'בואו נכיר את העסק שלך' }),
    ).toBeInTheDocument();
    expect(location()).toBe(businessWebPaths.onboarding);
    expect(screen.getByText('שלב 1 מתוך 4')).toBeInTheDocument();
  });

  it('resumes an unfinished business at its saved step (AC-01)', async () => {
    mockApi({
      [meKey]: me(testUser),
      [`GET ${bp.list}`]: () => json(200, { businesses: [{ ...draft, onboardingStep: 3 }] }),
      [detailKey]: () => json(200, { business: { ...draft, onboardingStep: 3 } }),
    });
    const { location } = renderApp('/app');
    expect(
      await screen.findByRole('heading', { name: 'באילו אזורים אתם נותנים שירות?' }),
    ).toBeInTheDocument();
    expect(location()).toBe(businessWebPaths.onboardingFor(draft.id));
  });

  it('step 1 validates in Hebrew, then creates the business and moves to step 2', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`POST ${bp.create}`]: () => json(201, { business: draft }),
      [detailKey]: () => json(200, { business: draft }),
    });
    const { user, location } = renderApp(businessWebPaths.onboarding);
    await screen.findByRole('heading', { name: 'בואו נכיר את העסק שלך' });

    await user.click(screen.getByRole('button', { name: 'המשך' }));
    expect(await screen.findByText('יש להזין את שם העסק')).toBeInTheDocument();
    expect(screen.getByText('יש לבחור תחום פעילות')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/שם העסק/), 'מספרת שירן');
    await user.selectOptions(screen.getByLabelText(/תחום פעילות/), 'beauty');
    await user.click(screen.getByRole('button', { name: 'המשך' }));

    expect(
      await screen.findByRole('heading', { name: 'איך לקוחות יכולים להגיע אליך?' }),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', bp.create)).toEqual([
      { name: 'מספרת שירן', industry: 'beauty' },
    ]);
    expect(location()).toBe(businessWebPaths.onboardingFor(draft.id));
  });

  it('step 2 rejects an invalid phone and saves a normalised one with the next step', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [detailKey]: () => json(200, { business: draft }),
      [patchKey]: patchEcho,
    });
    const { user } = renderApp(businessWebPaths.onboardingFor(draft.id));
    const phone = await screen.findByLabelText(/טלפון העסק/);
    expect(phone).toHaveAttribute('dir', 'ltr');

    await user.type(phone, '12345');
    await user.click(screen.getByRole('button', { name: 'המשך' }));
    expect(await screen.findByText(/מספר הטלפון אינו תקין/)).toBeInTheDocument();

    await user.clear(phone);
    await user.type(phone, '050-1234567');
    await user.click(screen.getByRole('button', { name: 'המשך' }));
    await screen.findByRole('heading', { name: 'באילו אזורים אתם נותנים שירות?' });
    expect(callsTo(fetchMock, 'PATCH', bp.detail(draft.id))).toEqual([
      { phone: '+972501234567', address: null, onboardingStep: 3 },
    ]);
  });

  it('step 3 adds and removes areas with the keyboard, and can be skipped', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [detailKey]: () => json(200, { business: { ...draft, onboardingStep: 3 } }),
      [patchKey]: patchEcho,
    });
    const { user } = renderApp(businessWebPaths.onboardingFor(draft.id));
    const input = await screen.findByLabelText('הוספת אזור שירות');
    await user.type(input, 'חיפה{Enter}יקנעם{Enter}חיפה{Enter}');
    const list = screen.getByRole('list', { name: 'אזורי השירות שנבחרו' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent?.replace('×', '')),
    ).toEqual(['חיפה', 'יקנעם']);
    await user.click(screen.getByRole('button', { name: 'הסרת חיפה' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'דילוג' }));
    await screen.findByRole('heading', { name: 'מתי העסק פתוח?' });
    expect(callsTo(fetchMock, 'PATCH', bp.detail(draft.id))).toEqual([{ onboardingStep: 4 }]);
  });

  it('step 4 validates the hours, then saves them, completes onboarding and opens the business', async () => {
    const step4 = { ...draft, onboardingStep: 4, phone: '+972501234567' };
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [detailKey]: () => json(200, { business: step4 }),
      [patchKey]: (body) => json(200, { business: { ...step4, ...(body as object) } }),
      [`POST ${bp.completeOnboarding(draft.id)}`]: () =>
        json(200, { business: { ...step4, status: 'ACTIVE' } }),
    });
    const { user, location } = renderApp(businessWebPaths.onboardingFor(draft.id));
    const sundayClose = await screen.findByLabelText('שעת סגירה ביום ראשון');
    await user.clear(sundayClose);
    await user.type(sundayClose, '08:00');
    await user.click(screen.getByRole('button', { name: 'סיום והמשך למערכת' }));
    expect(await screen.findByText('שעת הסגירה צריכה להיות אחרי שעת הפתיחה')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PATCH', bp.detail(draft.id))).toHaveLength(0);

    await user.clear(sundayClose);
    await user.type(sundayClose, '19:00');
    await user.click(screen.getByLabelText('שבת')); // open Saturday too
    await user.click(screen.getByRole('button', { name: 'סיום והמשך למערכת' }));

    await waitFor(() => expect(location()).toBe(businessWebPaths.home(draft.id)));
    const [patch] = callsTo(fetchMock, 'PATCH', bp.detail(draft.id));
    expect(patch.openingHours.sun).toEqual({ open: true, from: '09:00', to: '19:00' });
    expect(patch.openingHours.sat.open).toBe(true);
    expect(callsTo(fetchMock, 'POST', bp.completeOnboarding(draft.id))).toHaveLength(1);
  });

  it('tells a non-owner that only the owner can finish setup', async () => {
    mockApi({
      [meKey]: me(testUser),
      [detailKey]: () => json(200, { business: { ...draft, role: 'EMPLOYEE' } }),
    });
    renderApp(businessWebPaths.onboardingFor(draft.id));
    expect(await screen.findByText(/רק בעל\/ת העסק יכול\/ה להשלים/)).toBeInTheDocument();
  });
});

describe('business home', () => {
  it('shows the profile, the unverified banner, and the phone in LTR', async () => {
    mockApi({ [meKey]: me(testUser) });
    renderApp(businessWebPaths.home(testBusiness.id));
    expect(await screen.findByRole('heading', { name: 'שלום, דנה כהן' })).toBeInTheDocument();
    expect(screen.getByText('מספרת שירן · בעל/ת העסק')).toBeInTheDocument();
    expect(screen.getByText('050-1234567')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('region', { name: 'כדאי לאמת את כתובת האימייל' })).toBeInTheDocument();
  });

  it('shows "not found" for a business the user cannot access (API 404)', async () => {
    const other = '00000000-0000-4000-8000-000000000000';
    mockApi({
      [meKey]: me(testUser),
      [`GET ${bp.detail(other)}`]: () => apiError(404, 'NOT_FOUND', 'הפריט המבוקש לא נמצא'),
    });
    renderApp(businessWebPaths.home(other));
    expect(await screen.findByRole('heading', { name: 'העסק לא נמצא' })).toBeInTheDocument();
  });

  it('logs out and returns to /login', async () => {
    const fetchMock = mockApi({
      [meKey]: me(testUser),
      [`POST ${apiPaths.auth.logout}`]: noContent,
    });
    const { user, location } = renderApp(businessWebPaths.home(testBusiness.id));
    await user.click(await screen.findByRole('button', { name: 'התנתקות' }));
    await waitFor(() => expect(location()).toBe('/login'));
    expect(callsTo(fetchMock, 'POST', apiPaths.auth.logout)).toHaveLength(1);
  });
});
