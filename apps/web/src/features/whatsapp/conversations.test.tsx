import {
  AUTO_REPLY_DEFAULT,
  STATUS_PRESETS,
  apiPaths,
  botDefaultTextsFor,
  businessWebPaths,
  type Business,
  type InboxNumber,
  type WhatsAppInboxResponse,
} from '@leadflow/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callsTo, json, me, mockApi, renderApp, testBusiness, testUser } from '../../test/utils';

afterEach(() => vi.unstubAllGlobals());
// Most tests drive the full settings page: the first-time guide (D-144) counts as done.
const guideKey = `leadflow.whatsapp.setup.${testBusiness.id}`;
beforeEach(() => localStorage.setItem(guideKey, '1'));

const id = testBusiness.id;
const wp = apiPaths.whatsapp;
const meKey = `GET ${apiPaths.auth.me}`;
const page = businessWebPaths.section(id, 'conversations');
/** The automatic reply and bot settings have their own tab (D-129). */
const autoTab = `${page}?tab=auto`;

const number: InboxNumber = {
  id: '9a000000-0000-4000-8000-000000000001',
  phone: '+972541234567',
  profileName: 'נועה',
  messages: [
    {
      id: '8b000000-0000-4000-8000-000000000001',
      direction: 'IN',
      body: 'היי, יש תור מחר?',
      status: 'received',
      sender: null,
      createdAt: new Date().toISOString(),
    },
  ],
  lastMessageAt: new Date().toISOString(),
};
const DEFAULT_SHOWCASE = 'בינתיים, הנה הצצה לעבודות שלנו ✂️';
const noShowcase = { enabled: false, text: null, link: null, assetIds: [] };
const presets = STATUS_PRESETS.map((p) => ({ ...p, assetIds: [], preset: true, video: null }));
/** Saved settings: the booking bot by default here (most tests drive its card). */
const botSettings = (mode: 'off' | 'auto_reply' | 'booking' = 'booking') => ({
  mode,
  autoReplyText: null,
  autoReplyDefault: AUTO_REPLY_DEFAULT,
  statuses: presets,
  activeStatus: null,
  videoBytesUsed: 0,
  enabled: mode === 'booking',
  autoConfirm: true,
  holdDate: false,
  flow: 'appointment',
  flowIsDefault: true,
  defaults: botDefaultTextsFor('beauty'),
  texts: {},
  showcase: { enabled: false, defaultText: DEFAULT_SHOWCASE, link: null, assetIds: [] },
});
/** The API answers a PUT with what it saved (plus the industry default). */
const echoBot = (body: unknown) => {
  const b = body as { showcase: { text: string | null }; flow: string | null };
  return json(200, {
    connected: true,
    settings: {
      ...botSettings(),
      ...b,
      statuses: (b as unknown as { statuses?: object[] }).statuses
        ? (b as unknown as { statuses: object[] }).statuses.map((x) => ({
            assetIds: [],
            ...x,
            preset: true,
            video: null,
          }))
        : presets,
      flow: b.flow ?? 'appointment',
      flowIsDefault: b.flow === null,
      defaults: botDefaultTextsFor('beauty'),
      showcase: {
        ...b.showcase,
        text: b.showcase.text ?? undefined,
        defaultText: DEFAULT_SHOWCASE,
      },
    },
  });
};
const photo = {
  id: '7a000000-0000-4000-8000-000000000001',
  url: '/media/x/photo.webp',
  width: 800,
  height: 600,
  sizeBytes: 1000,
  originalName: 'cut.jpg',
  createdAt: new Date().toISOString(),
};

function routes(inbox: WhatsAppInboxResponse, extra = {}) {
  return {
    [meKey]: me(testUser),
    [`GET ${wp.inbox(id)}`]: () => json(200, inbox),
    [`GET ${wp.personal(id)}`]: () => json(200, { numbers: [] }),
    [`GET ${wp.bot(id)}`]: () => json(200, { connected: true, settings: botSettings() }),
    ...extra,
  };
}

describe('WhatsApp conversations inbox', () => {
  it('first time: sets up the automatic reply in three steps (D-144)', async () => {
    localStorage.removeItem(guideKey);
    const fetchMock = mockApi(
      routes(
        { connected: true, numbers: [] },
        {
          [`GET ${wp.bot(id)}`]: () =>
            json(200, { connected: true, settings: botSettings('auto_reply') }),
          [`PUT ${wp.bot(id)}`]: echoBot,
        },
      ),
    );
    const { user } = renderApp(autoTab);
    expect(await screen.findByText('שלב 1 מתוך 3')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /קביעת תורים אוטומטית/ }));
    await user.click(screen.getByRole('button', { name: 'המשך' }));
    expect(screen.getByText('שלב 2 מתוך 3')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /מחכה לאישור שלי/ }));
    await user.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByRole('heading', { name: 'הכול מוכן!' })).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PUT', wp.bot(id))).toEqual([
      expect.objectContaining({ mode: 'booking', enabled: true, autoConfirm: false }),
    ]);
    expect(localStorage.getItem(guideKey)).toBe('1');
    await user.click(screen.getByRole('button', { name: 'סיום' }));
    // Then the full page, with a way back to the guide.
    // Then the two cards, the bot's switch on (D-147).
    expect(await screen.findByRole('switch', { name: 'קביעת תורים אוטומטית' })).toBeInTheDocument();
  });

  it('booking bot: picks the approval, saved together with "Save bot settings"', async () => {
    const fetchMock = mockApi(
      routes({ connected: true, numbers: [] }, { [`PUT ${wp.bot(id)}`]: echoBot }),
    );
    const { user } = renderApp(autoTab);
    const pending = await screen.findByRole('radio', { name: /מחכה לאישור שלי/ });
    const saveButton = screen.getByRole('button', { name: 'שמירת ההגדרות' });
    expect(saveButton).toBeDisabled();
    await user.click(pending);
    // Nothing is sent until saving.
    expect(screen.getByText('יש שינויים שעוד לא נשמרו')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PUT', wp.bot(id))).toHaveLength(0);
    await user.click(saveButton);
    expect(await screen.findByText('ההגדרות נשמרו.')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PUT', wp.bot(id))).toEqual([
      {
        mode: 'booking',
        autoReplyText: null,
        enabled: true,
        autoConfirm: false,
        holdDate: false,
        flow: null,
        texts: {},
        showcase: noShowcase,
      },
    ]);
  });

  it('"Discard changes" puts the saved settings back', async () => {
    mockApi(routes({ connected: true, numbers: [] }));
    const { user } = renderApp(autoTab);
    await user.click(await screen.findByRole('radio', { name: /מחכה לאישור שלי/ }));
    await user.click(screen.getByRole('button', { name: 'ביטול השינויים' }));
    expect(screen.getByRole('radio', { name: /מאושר מיד/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'שמירת ההגדרות' })).toBeDisabled();
  });

  it('automatic reply: pick a status, see and edit what customers get (D-146)', async () => {
    let settings = botSettings('auto_reply');
    const fetchMock = mockApi(
      routes(
        { connected: true, numbers: [] },
        {
          [`GET ${wp.bot(id)}`]: () => json(200, { connected: true, settings }),
          [`PUT ${wp.bot(id)}`]: echoBot,
          [`PUT ${wp.status(id)}`]: (body: unknown) => {
            settings = { ...settings, activeStatus: body as never };
            return json(200, { connected: true, settings });
          },
        },
      ),
    );
    const { user } = renderApp(autoTab);
    // Two switches (D-147): the automatic reply is on, the bot's settings stay folded.
    expect(await screen.findByRole('switch', { name: 'מענה אוטומטי' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'קביעת תורים אוטומטית' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.queryByRole('button', { name: 'שמירת ההגדרות' })).not.toBeInTheDocument();

    // Available: the general message, no save button until it changes, no "how long".
    const message = screen.getByLabelText('מה לקוחות מקבלים עכשיו');
    expect(message).toHaveValue(AUTO_REPLY_DEFAULT.replace('{business}', '[שם העסק]'));
    expect(screen.queryByRole('button', { name: 'שמירת ההודעה' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('לכמה זמן:')).not.toBeInTheDocument();
    await user.clear(message);
    await user.type(message, 'שלום מ[[שם העסק]!');
    await user.click(screen.getByRole('button', { name: 'שמירת ההודעה' }));
    expect(callsTo(fetchMock, 'PUT', wp.bot(id))[0]).toMatchObject({
      mode: 'auto_reply',
      autoReplyText: 'שלום מ{business}!',
    });

    // A status: saved at once, and the box shows its message.
    const statuses = screen.getByRole('group', { name: 'בחירת סטטוס' });
    const before = Date.now();
    await user.click(within(statuses).getByRole('button', { name: 'באירוע' }));
    expect(callsTo(fetchMock, 'PUT', wp.status(id))[0]).toEqual({ id: 'event', until: null });
    expect(await screen.findByLabelText('מה לקוחות מקבלים כשאתם "באירוע"')).toHaveValue(
      presets[0]!.text,
    );
    // The status's own photos and video (D-164).
    const media = screen.getByRole('region', { name: 'תמונות וסרטון לסטטוס "באירוע"' });
    expect(within(media).getByRole('button', { name: 'הוספת תמונה' })).toBeInTheDocument();
    expect(within(media).getByRole('button', { name: 'הוספת סרטון' })).toBeInTheDocument();
    // How long, once you're away.
    await user.selectOptions(screen.getByLabelText('לכמה זמן:'), 'לשעה');
    const sent = callsTo(fetchMock, 'PUT', wp.status(id))[1] as { id: string; until: string };
    expect(sent.id).toBe('event');
    const ahead = new Date(sent.until).getTime() - before;
    expect(ahead).toBeGreaterThan(59 * 60_000);
    expect(ahead).toBeLessThan(61 * 60_000);
  });

  it('two switches, one at a time; each keeps its settings (D-147)', async () => {
    const fetchMock = mockApi(
      routes(
        { connected: true, numbers: [] },
        {
          [`GET ${wp.bot(id)}`]: () =>
            json(200, { connected: true, settings: botSettings('auto_reply') }),
          [`PUT ${wp.bot(id)}`]: echoBot,
        },
      ),
    );
    const { user } = renderApp(autoTab);
    const bot = await screen.findByRole('switch', { name: 'קביעת תורים אוטומטית' });
    // The bot can be set up while it's off.
    await user.click(screen.getByRole('button', { name: 'הגדרות' }));
    expect(screen.getByRole('button', { name: 'שמירת ההגדרות' })).toBeInTheDocument();
    // Turning it on turns the automatic reply off.
    await user.click(bot);
    expect(callsTo(fetchMock, 'PUT', wp.bot(id))[0]).toMatchObject({
      mode: 'booking',
      enabled: true,
    });
    await waitFor(() => expect(bot).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByRole('switch', { name: 'מענה אוטומטי' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    // And off again: nothing answers.
    await user.click(bot);
    expect(callsTo(fetchMock, 'PUT', wp.bot(id))[1]).toMatchObject({ mode: 'off', enabled: false });
  });

  it('adds an own status with a name and a message', async () => {
    const fetchMock = mockApi(
      routes(
        { connected: true, numbers: [] },
        {
          [`GET ${wp.bot(id)}`]: () =>
            json(200, { connected: true, settings: botSettings('auto_reply') }),
          [`PUT ${wp.bot(id)}`]: echoBot,
        },
      ),
    );
    const { user } = renderApp(autoTab);
    await user.click(await screen.findByRole('button', { name: 'סטטוס חדש' }));
    await user.click(screen.getByRole('button', { name: 'הוספה' }));
    expect(await screen.findByText('יש לתת שם לסטטוס')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PUT', wp.bot(id))).toHaveLength(0);
    await user.type(screen.getByLabelText('שם הסטטוס'), 'באולפן');
    await user.type(screen.getByLabelText('ההודעה ללקוח'), 'באולפן עד הערב 🎧');
    await user.click(screen.getByRole('button', { name: 'הוספה' }));
    const body = callsTo(fetchMock, 'PUT', wp.bot(id))[0] as {
      statuses: { label: string; text: string; id: string }[];
    };
    expect(body.statuses.at(-1)).toMatchObject({ label: 'באולפן', text: 'באולפן עד הערב 🎧' });
    expect(body.statuses.at(-1)!.id).toMatch(/^c-/);
    expect(await screen.findByRole('button', { name: 'באולפן' })).toBeInTheDocument();
  });

  it('edits the bot messages with a live preview, and keeps unchanged ones as defaults', async () => {
    const fetchMock = mockApi(
      routes(
        { connected: true, numbers: [] },
        {
          [`PUT ${wp.bot(id)}`]: echoBot,
        },
      ),
    );
    const { user } = renderApp(autoTab);
    await user.click(await screen.findByRole('button', { name: 'עריכת ההודעות ללקוחות' }));
    // Placeholders read as tags in the owner's language, not codes.
    expect(screen.getByLabelText('הודעת פתיחה')).toHaveValue(
      'שלום! כאן [שם העסק] 👋\nרוצים לקבוע תור? בחרו שירות:',
    );
    const confirmed = screen.getByLabelText('אישור תור');
    await user.clear(confirmed);
    await user.type(confirmed, 'נתראה ב{{business}, {{name}');
    await user.click(screen.getByRole('button', { name: 'שמירת ההודעות' }));
    expect(await screen.findByText(/אי אפשר להשתמש בסוגריים מסולסלים/)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PUT', wp.bot(id))).toHaveLength(0);

    await user.clear(confirmed);
    await user.type(confirmed, 'נתראה ב!');
    await user.keyboard('{ArrowLeft}');
    await user.click(screen.getByRole('button', { name: 'הוספה: שם העסק (אישור תור)' }));
    expect(confirmed).toHaveValue('נתראה ב[שם העסק]!');
    expect(screen.getByText(`נתראה ב${testBusiness.name}!`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'שמירת ההודעות' }));
    expect(await screen.findByText('ההודעות נשמרו.')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PUT', wp.bot(id))).toEqual([
      {
        mode: 'booking',
        autoReplyText: null,
        enabled: true,
        autoConfirm: true,
        holdDate: false,
        flow: null,
        texts: { confirmed: 'נתראה ב{business}!' },
        showcase: noShowcase,
      },
    ]);
  });

  it('the shared "meanwhile" card: its switch, and the editor in a pop-up (D-106, D-149)', async () => {
    const fetchMock = mockApi(
      routes(
        { connected: true, numbers: [] },
        {
          [`PUT ${wp.bot(id)}`]: echoBot,
          [`GET ${apiPaths.media.assets(id)}`]: () =>
            json(200, { assets: [photo], usedBytes: 1000, quotaBytes: 100_000_000 }),
        },
      ),
    );
    const { user } = renderApp(autoTab);
    // Its own switch, saved at once.
    await user.click(await screen.findByRole('switch', { name: 'הצצה לעסק' }));
    expect(callsTo(fetchMock, 'PUT', wp.bot(id))[0]).toMatchObject({
      showcase: { enabled: true },
    });
    await user.click(screen.getByRole('button', { name: 'עריכת ההצצה' }));
    // The industry's default message, ready to edit.
    expect(await screen.findByLabelText('ההודעה')).toHaveValue(DEFAULT_SHOWCASE);
    // Photos and a video (D-151), uploaded on its own.
    expect(screen.getByRole('button', { name: 'הוספת סרטון' })).toBeInTheDocument();
    // The customer's view only on request (D-155).
    expect(screen.queryByText('כך הלקוח יראה את זה:')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'תצוגה מקדימה' }));
    expect(screen.getByText('כך הלקוח יראה את זה:')).toBeInTheDocument();
    await user.type(screen.getByLabelText('קישור (לא חובה)'), 'instagram.com/sigalit');
    await user.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText('יש להזין קישור מלא שמתחיל ב־https://')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PUT', wp.bot(id))).toHaveLength(1);

    await user.clear(screen.getByLabelText('קישור (לא חובה)'));
    await user.type(screen.getByLabelText('קישור (לא חובה)'), 'https://instagram.com/sigalit');
    await user.click(screen.getByRole('button', { name: 'הוספת תמונה' }));
    const picker = await screen.findByRole('dialog', { name: 'בחירת תמונה להצצה' });
    await user.click(await within(picker).findByRole('button', { name: 'בחירת cut.jpg' }));
    expect(
      within(screen.getByRole('list', { name: 'תמונות בהצצה' })).getAllByRole('listitem'),
    ).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'שמירה' }));
    expect(await screen.findByText('ההצצה נשמרה.')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PUT', wp.bot(id))[1]).toEqual({
      mode: 'booking',
      autoReplyText: null,
      enabled: true,
      autoConfirm: true,
      holdDate: false,
      flow: null,
      texts: {},
      showcase: {
        enabled: true,
        text: null,
        link: 'https://instagram.com/sigalit',
        assetIds: [photo.id],
      },
    });
  });

  it('switches to event requests, which changes the messages to edit (D-107)', async () => {
    const fetchMock = mockApi(
      routes({ connected: true, numbers: [] }, { [`PUT ${wp.bot(id)}`]: echoBot }),
    );
    const { user } = renderApp(autoTab);
    const events = await screen.findByRole('radio', { name: /בקשה לאירוע/ });
    expect(screen.getByRole('radio', { name: /תור בשעה פנויה/ })).toBeChecked();
    expect(screen.getByText(/מתאים לתחום שלכם/)).toBeInTheDocument();
    await user.click(events);
    await user.click(screen.getByRole('button', { name: 'שמירת ההגדרות' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'PUT', wp.bot(id)).at(-1)).toMatchObject({ flow: 'event' }),
    );
    expect(await screen.findByText(/הבקשה מחכה לאישור שלכם בעמוד התורים/)).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /מאושר מיד/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'עריכת ההודעות ללקוחות' }));
    expect(screen.getByLabelText('בקשה לאירוע התקבלה')).toBeInTheDocument();
    expect(screen.queryByLabelText('אישור תור')).not.toBeInTheDocument();
  });

  it('lists personal numbers and undoes a marking', async () => {
    const personalId = '9a000000-0000-4000-8000-000000000002';
    const fetchMock = mockApi(
      routes(
        { connected: true, numbers: [] },
        {
          [`GET ${wp.personal(id)}`]: () =>
            json(200, {
              numbers: [{ id: personalId, phone: '+972521112233', classifiedAt: null }],
            }),
          [`DELETE ${wp.number(id, personalId)}`]: () => new Response(null, { status: 204 }),
        },
      ),
    );
    const { user } = renderApp(page);
    await user.click(await screen.findByRole('tab', { name: /מספרים פרטיים/ }));
    await user.click(screen.getByRole('button', { name: 'ביטול סימון פרטי ל-052-1112233' }));
    await waitFor(() =>
      expect(callsTo(fetchMock, 'DELETE', wp.number(id, personalId))).toHaveLength(1),
    );
  });

  it('employees get a no-permission state and no menu link', async () => {
    mockApi({
      ...routes({ connected: true, numbers: [number] }),
      [`GET ${apiPaths.businesses.detail(id)}`]: () =>
        json(200, { business: { ...testBusiness, role: 'EMPLOYEE' as Business['role'] } }),
      [`GET ${apiPaths.businesses.list}`]: () =>
        json(200, { businesses: [{ ...testBusiness, role: 'EMPLOYEE' }] }),
    });
    renderApp(page);
    expect(
      await screen.findByRole('heading', { name: 'אין לך הרשאה לצפות בשיחות' }),
    ).toBeInTheDocument();
    const nav = screen.getAllByRole('navigation', { name: 'ניווט ראשי' })[0]!;
    expect(within(nav).queryByRole('link', { name: /שיחות/ })).not.toBeInTheDocument();
  });

  it('the leads page points to waiting numbers', async () => {
    mockApi(routes({ connected: true, numbers: [number, { ...number, id: crypto.randomUUID() }] }));
    renderApp(businessWebPaths.section(id, 'leads'));
    expect(await screen.findByText(/2 מספרים חדשים כתבו בוואטסאפ/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'לשיחות' })).toHaveAttribute('href', page);
  });
});
