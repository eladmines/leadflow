import { apiPaths, businessWebPaths, type ChannelsResponse } from '@leadflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callsTo, json, me, mockApi, renderApp, testBusiness, testUser } from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());

const id = testBusiness.id;
const ch = apiPaths.channels;
const page = `${businessWebPaths.section(id, 'settings')}?tab=channels`;
const off: ChannelsResponse = {
  whatsapp: { channel: 'whatsapp', connected: false, name: null, source: null },
  messenger: { channel: 'messenger', connected: false, name: null, source: null },
  email: { channel: 'email', connected: false, name: null, source: null },
  emailInbound: true,
  facebookLogin: true,
};
const pendingId = '6f000000-0000-4000-8000-000000000001';

describe('Settings → Channels (F25)', () => {
  it('connects WhatsApp with a Phone number ID and a token', async () => {
    const fetchMock = mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${ch.list(id)}`]: () => json(200, off),
      [`POST ${ch.whatsapp(id)}`]: () =>
        json(200, {
          ...off,
          whatsapp: {
            channel: 'whatsapp',
            connected: true,
            name: '+1 555-000-1111',
            source: 'business',
          },
        }),
    });
    const { user } = renderApp(page);
    // Every channel in the same box, with a plug switch: pulled out until connected (D-161).
    const whatsapp = await screen.findByRole('switch', { name: 'WhatsApp' });
    expect(whatsapp).toHaveAttribute('aria-checked', 'false');
    expect(screen.getAllByText('לא מחובר')).toHaveLength(3);
    // Instagram is on its way (D-160): shown, its plug not usable yet.
    expect(screen.getByRole('heading', { name: /Instagram/ })).toHaveTextContent('בקרוב');
    expect(screen.getByRole('switch', { name: 'Instagram' })).toBeDisabled();
    await user.click(whatsapp);
    // The form explains where the two details come from, with links to Meta.
    expect(await screen.findByText('איך משיגים את הפרטים?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Meta for Developers/ })).toHaveAttribute(
      'href',
      'https://developers.facebook.com/apps',
    );
    expect(screen.getByRole('link', { name: /המדריך המלא של Meta/ })).toHaveAttribute(
      'target',
      '_blank',
    );
    await user.type(screen.getByLabelText('Phone number ID'), '555000111');
    await user.type(screen.getByLabelText('טוקן גישה'), 'EAA-whatsapp-token-0123456789');
    await user.click(screen.getByRole('button', { name: 'חיבור' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', ch.whatsapp(id))).toEqual([
        { phoneNumberId: '555000111', accessToken: 'EAA-whatsapp-token-0123456789' },
      ]),
    );
    expect(await screen.findByText('+1 555-000-1111')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'WhatsApp' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('creates the forwarding address for email and shows it to copy (F27)', async () => {
    const connected: ChannelsResponse = {
      ...off,
      email: {
        channel: 'email',
        connected: true,
        name: 'k7m2q9x4pa@mail.example.com',
        source: 'business',
      },
    };
    const fetchMock = mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${ch.list(id)}`]: () => json(200, off),
      [`POST ${ch.email(id)}`]: () => json(200, connected),
    });
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('switch', { name: 'אימייל' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', ch.email(id))).toHaveLength(1));
    expect(await screen.findByText('k7m2q9x4pa@mail.example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'העתקה' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'אימייל' })).toHaveAttribute('aria-checked', 'true');
  });

  it('says email is not set up when the server cannot receive it', async () => {
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${ch.list(id)}`]: () => json(200, { ...off, emailInbound: false }),
    });
    renderApp(page);
    expect(await screen.findByRole('switch', { name: 'אימייל' })).toBeDisabled();
    expect(screen.getByText('קבלת מייל עוד לא הוגדרה בשרת.')).toBeInTheDocument();
  });

  it('"Connect Facebook" goes to Facebook’s sign-in', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${ch.list(id)}`]: () => json(200, off),
      [`GET ${ch.facebookStart(id)}`]: () =>
        json(200, { url: 'https://www.facebook.com/v21.0/dialog/oauth?client_id=1' }),
    });
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('switch', { name: 'פייסבוק' }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        'https://www.facebook.com/v21.0/dialog/oauth?client_id=1',
      ),
    );
  });

  it('back from Facebook: choose the Page to connect', async () => {
    const fetchMock = mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${ch.list(id)}`]: () => json(200, off),
      [`GET ${ch.facebookPages(id, pendingId)}`]: () =>
        json(200, {
          pages: [
            { id: '111', name: 'מספרת שירן' },
            { id: '222', name: 'דף אחר' },
          ],
        }),
      [`POST ${ch.facebook(id)}`]: () =>
        json(200, {
          ...off,
          messenger: { channel: 'messenger', connected: true, name: 'דף אחר', source: 'business' },
        }),
    });
    const { user } = renderApp(`${page}&facebook=${pendingId}`);
    const dialog = await screen.findByRole('dialog', { name: 'איזה דף לחבר?' });
    await user.click(await within(dialog).findByRole('radio', { name: 'דף אחר' }));
    await user.click(within(dialog).getByRole('button', { name: 'חיבור הדף' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'POST', ch.facebook(id))).toEqual([{ pendingId, pageId: '222' }]),
    );
    expect(await screen.findByText('דף אחר')).toBeInTheDocument();
  });

  it('explains a failed sign-in; non-owners only see the status', async () => {
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${ch.list(id)}`]: () => json(200, off),
    });
    renderApp(`${page}&facebook=error`);
    expect(await screen.findByText('החיבור לפייסבוק לא הצליח. נסו שוב.')).toBeInTheDocument();
  });

  it('turning a connected plug off asks for confirmation first', async () => {
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${ch.list(id)}`]: () =>
        json(200, {
          ...off,
          whatsapp: {
            channel: 'whatsapp',
            connected: true,
            name: '+1 555-000-1111',
            source: 'business',
          },
        }),
    });
    const { user } = renderApp(page);
    const plug = await screen.findByRole('switch', { name: 'WhatsApp' });
    expect(plug).toHaveAttribute('aria-checked', 'true');
    await user.click(plug);
    expect(await screen.findByRole('button', { name: 'כן, לנתק' })).toBeInTheDocument();
    // Still connected until confirmed.
    expect(screen.getByRole('switch', { name: 'WhatsApp' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'ביטול' }));
    expect(screen.queryByRole('button', { name: 'כן, לנתק' })).not.toBeInTheDocument();
  });

  it('a manager sees the status without connect buttons', async () => {
    mockApi({
      [`GET ${apiPaths.auth.me}`]: me(testUser),
      [`GET ${apiPaths.businesses.detail(id)}`]: () =>
        json(200, { business: { ...testBusiness, role: 'MANAGER' } }),
      [`GET ${apiPaths.businesses.list}`]: () =>
        json(200, { businesses: [{ ...testBusiness, role: 'MANAGER' }] }),
      [`GET ${ch.list(id)}`]: () =>
        json(200, {
          ...off,
          whatsapp: { channel: 'whatsapp', connected: true, name: null, source: 'environment' },
        }),
    });
    renderApp(page);
    expect(await screen.findByText('דרך הגדרות המערכת')).toBeInTheDocument();
    // The plugs show the state but a manager can't change them.
    expect(screen.getByRole('switch', { name: 'WhatsApp' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'פייסבוק' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'כן, לנתק' })).not.toBeInTheDocument();
  });
});
