/**
 * Sample data for one business, so a demo account looks lived-in: leads in every stage (website,
 * WhatsApp, manual) with history and notes, tasks, services and appointments, quotes, and WhatsApp
 * conversations. Everything it adds is tagged "דוגמה" and can be removed again.
 *
 *   DATABASE_URL='postgresql://…' pnpm --filter @leadflow/api seed:demo --email ido@example.com
 *   DATABASE_URL='postgresql://…' pnpm --filter @leadflow/api seed:demo --email ido@example.com --remove
 *
 * The database is never taken from .env: the address must be given on the command line, so it is
 * always a deliberate choice which database gets the data.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { WEEKDAYS } from '@leadflow/shared';
import { generateToken } from '../src/lib/crypto';
import { zonedTimeToUtc } from '../src/lib/time';

const TAG = 'דוגמה';
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const email = arg('email')?.trim().toLowerCase();
const remove = args.includes('--remove');

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL to the database to fill (it is not read from .env).');
  process.exit(1);
}
if (!email) {
  console.error('Usage: seed:demo --email <the account’s email> [--remove]');
  process.exit(1);
}

// Prisma reads .env as it loads, so it's loaded only after the address was checked above, and
// is pointed at that address explicitly.
const databaseUrl = process.env.DATABASE_URL;
const { PrismaClient: Client } = await import('@prisma/client');
const prisma: PrismaClient = new Client({ datasources: { db: { url: databaseUrl } } });
const { ensureStages } = await import('../src/modules/leads/service');
const DAY = 86_400_000;
const now = new Date();

/** YYYY-MM-DD in a time zone, `days` from today. */
const dayIn = (tz: string, days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(now.getTime() + days * DAY));
const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY - hours * 3_600_000);

type Kind = 'events' | 'beauty' | 'trades' | 'general';
const kindOf = (industry: string): Kind =>
  ['events', 'catering', 'photo'].includes(industry)
    ? 'events'
    : ['beauty', 'studio'].includes(industry)
      ? 'beauty'
      : ['trades', 'auto'].includes(industry)
        ? 'trades'
        : 'general';

const CONTENT: Record<
  Kind,
  { services: [string, number, number][]; asks: string[]; items: [string, number][] }
> = {
  events: {
    services: [
      ['פגישת היכרות', 30, 0],
      ['חתונה — DJ מלא', 360, 6500],
      ['בר/בת מצווה', 240, 4200],
    ],
    asks: [
      'מחפשים DJ לחתונה ב־14.2, כ־250 אורחים',
      'בר מצווה באולם בחולון, אפשר הצעת מחיר?',
      'אירוע חברה לכ־120 עובדים בסוף החודש',
      'יום הולדת 40 בבית, משהו קטן וחם',
      'חינה ב־20.3, מוזיקה מזרחית בעיקר',
      'האם יש לכם גם תאורה ועשן?',
      'חתונה בגן אירועים בצפון, תאריך גמיש',
      'מסיבת רווקות, 30 בנות',
    ],
    items: [
      ['DJ לאירוע — 6 שעות', 650000],
      ['תאורת רחבה', 120000],
      ['מכונת עשן כבד', 80000],
      ['הגברה לטקס חופה', 90000],
    ],
  },
  beauty: {
    services: [
      ['תספורת נשים', 45, 180],
      ['צבע שורשים', 90, 320],
      ['החלקה', 150, 900],
    ],
    asks: [
      'תספורת + צבע ביום חמישי?',
      'כמה עולה החלקה אורגנית?',
      'תור לתספורת לבת שלי (8)',
      'יש תור פנוי מחר בבוקר?',
      'תסרוקת לחתונה ב־12.3, כולל ניסיון',
      'גוונים בלונד, שיער ארוך',
      'אני רוצה לשנות צבע לגמרי',
      'כמה זמן לוקח טיפול קרטין?',
    ],
    items: [
      ['תסרוקת כלה כולל ניסיון', 120000],
      ['איפור כלה', 90000],
      ['תסרוקת מלווה', 35000],
      ['החלקה אורגנית', 90000],
    ],
  },
  trades: {
    services: [
      ['ביקור ואבחון', 60, 250],
      ['תיקון תקלה', 90, 450],
      ['התקנה', 180, 1200],
    ],
    asks: [
      'נפל לי החשמל בחצי בית',
      'צריך להתקין מזגן בחדר שינה',
      'נזילה מתחת לכיור במטבח',
      'הצעת מחיר לשיפוץ חדר אמבטיה',
      'החלפת לוח חשמל ישן',
      'שקע שמתחמם, דחוף',
      'התקנת גוף תאורה בסלון',
      'בדיקה לפני קניית דירה',
    ],
    items: [
      ['החלפת לוח חשמל', 280000],
      ['נקודת חשמל חדשה', 35000],
      ['עבודה — שעת טכנאי', 25000],
      ['חומרים', 60000],
    ],
  },
  general: {
    services: [
      ['שיחת ייעוץ', 30, 0],
      ['פגישה', 60, 300],
      ['חבילה מורחבת', 120, 900],
    ],
    asks: [
      'אשמח לפרטים על השירות',
      'כמה זה עולה?',
      'אפשר לקבוע פגישה בשבוע הבא?',
      'ראיתי אתכם באינסטגרם, מתעניין',
      'יש לכם זמינות בסוף החודש?',
      'קיבלתי המלצה מחברה',
      'אפשר הצעת מחיר מסודרת?',
      'מה כולל השירות?',
    ],
    items: [
      ['חבילה בסיסית', 150000],
      ['חבילה מורחבת', 290000],
      ['שעת ייעוץ', 30000],
      ['תוספת דחופה', 50000],
    ],
  },
};

const PEOPLE: [string, string | null][] = [
  ['נועה לוי', 'noa.levi@example.com'],
  ['יוסי מזרחי', null],
  ['שירה כהן', 'shira.c@example.com'],
  ['אבי פרץ', null],
  ['מיכל אברהם', 'michal.a@example.com'],
  ['דניאל ביטון', null],
  ['רונית שמעוני', 'ronit.sh@example.com'],
  ['עומר גבאי', null],
  ['תמר דהן', 'tamar.d@example.com'],
  ['איתי פרידמן', null],
  ['ליאת אזולאי', 'liat.az@example.com'],
  ['גיא חדד', null],
  ['הדר רוזן', 'hadar.r@example.com'],
  ['יעל ששון', null],
  ['אלון קפלן', 'alon.k@example.com'],
  ['מאיה שטרן', null],
  ['רועי ברק', 'roi.b@example.com'],
  ['אורית נחום', null],
  ['עידן סלע', 'idan.s@example.com'],
  ['קרן וקנין', null],
];
/** Fake but valid-looking Israeli mobiles (+972 50-000-01xx), unique per person. */
const phoneOf = (i: number) => `+97250000${String(100 + i).padStart(4, '0')}`;

async function main() {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No account with the email ${email}.`);
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, role: 'OWNER', status: 'ACTIVE' },
    include: { business: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!membership)
    throw new Error(`${email} doesn't own a business yet (finish onboarding first).`);
  const business = membership.business;
  const demoLeads = await prisma.lead.findMany({
    where: { businessId: business.id, tags: { has: TAG } },
    select: { id: true, contactId: true },
  });

  if (remove) {
    const phones = PEOPLE.map((_, i) => phoneOf(i)).concat('+972500009999');
    await prisma.$transaction([
      prisma.task.deleteMany({
        where: { businessId: business.id, leadId: { in: demoLeads.map((l) => l.id) } },
      }),
      prisma.whatsAppNumber.deleteMany({
        where: { businessId: business.id, phone: { in: phones } },
      }),
      prisma.contact.deleteMany({
        where: { businessId: business.id, id: { in: demoLeads.map((l) => l.contactId) } },
      }),
    ]);
    console.log(`Removed the sample data from "${business.name}" (${demoLeads.length} leads).`);
    return;
  }
  if (demoLeads.length) {
    console.log(
      `"${business.name}" already has sample data. Run with --remove first to start over.`,
    );
    return;
  }

  const tz = business.timezone;
  /** The day `days` from today, moved forward past days the business is closed. */
  const hours = (business.openingHours ?? {}) as Record<string, { open?: boolean } | undefined>;
  const weekday = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
  const openDay = (days: number) => {
    for (let d = days; d < days + 7; d += 1) {
      const date = dayIn(tz, d);
      if (hours[weekday(date)]?.open !== false) return date;
    }
    return dayIn(tz, days);
  };
  const kind = kindOf(business.industry);
  const content = CONTENT[kind];
  // The app creates the default stages the first time the leads page opens; same here.
  const stages = await ensureStages(prisma, business.id);
  const open = stages.filter((s) => s.kind === 'OPEN');
  const won = stages.find((s) => s.kind === 'WON')!;
  const lost = stages.find((s) => s.kind === 'LOST')!;

  await prisma.$transaction(
    async (tx) => {
      // Services, unless the business already set up its own.
      const services = await tx.service.findMany({
        where: { businessId: business.id, active: true },
      });
      if (!services.length) {
        for (const [name, durationMin, price] of content.services) {
          services.push(
            await tx.service.create({
              data: { businessId: business.id, name, durationMin, price: price || null },
            }),
          );
        }
      }

      // 20 leads: most open across the stages, a few won and lost.
      const plan = PEOPLE.map((p, i) => {
        const stage =
          // Some won and lost in the last week, so the dashboard's close rate has numbers.
          i % 10 === 3 ? won : i % 10 === 4 ? lost : (open[i % open.length] ?? open[0]!);
        const source = (['website_form', 'whatsapp', 'manual'] as const)[i % 3]!;
        return { person: p, i, stage, source, created: ago(i * 1.4 + 0.2, (i * 7) % 11) };
      });
      const leads: {
        id: string;
        contactId: string;
        name: string;
        phone: string;
        i: number;
        source: string;
      }[] = [];
      for (const { person, i, stage, source, created } of plan) {
        const [name, mail] = person;
        const contact = await tx.contact.create({
          data: {
            businessId: business.id,
            name,
            phone: phoneOf(i),
            email: mail,
            createdAt: created,
          },
        });
        const lead = await tx.lead.create({
          data: {
            businessId: business.id,
            contactId: contact.id,
            stageId: stage.id,
            ownerId: user.id,
            source,
            sourceUrl: source === 'website_form' ? 'https://example.com/' : null,
            message: content.asks[i % content.asks.length],
            expectedValue: i % 3 === 0 ? [450, 1200, 3800, 6500, 900][i % 5] : null,
            tags: i % 7 === 2 ? [TAG, 'VIP'] : [TAG],
            createdAt: created,
          },
        });
        leads.push({ id: lead.id, contactId: contact.id, name, phone: phoneOf(i), i, source });
        const history: Prisma.ActivityCreateManyInput[] = [
          {
            businessId: business.id,
            leadId: lead.id,
            type: 'lead.created',
            data: { source, contactReused: false },
            createdAt: created,
          },
        ];
        if (stage.id !== stages[0]!.id) {
          history.push({
            businessId: business.id,
            leadId: lead.id,
            actorId: user.id,
            type: 'lead.stage_changed',
            data: { from: stages[0]!.name, to: stage.name, toKind: stage.kind },
            createdAt: new Date(created.getTime() + 3 * 3_600_000),
          });
        }
        if (i % 4 === 1) {
          history.push({
            businessId: business.id,
            leadId: lead.id,
            actorId: user.id,
            type: 'lead.note',
            data: {
              text: [
                'דיברנו בטלפון, מחכה לאישור מבן/בת הזוג',
                'ביקש/ה לחזור אחרי החגים',
                'שלחתי פרטים בוואטסאפ',
                'לקוח/ה חוזר/ת, מאוד מרוצה',
              ][i % 4],
            },
            createdAt: new Date(created.getTime() + 5 * 3_600_000),
          });
        }
        await tx.activity.createMany({ data: history });
      }

      // Tasks: two overdue, three today, three coming up, one done.
      const tasks: [string, number, boolean][] = [
        ['להתקשר לחזור — לא ענה אתמול', -2, false],
        ['לשלוח הצעת מחיר מעודכנת', -1, false],
        ['לאשר תאריך מול הלקוח', 0, false],
        ['לבדוק זמינות ציוד', 0, false],
        ['שיחת מעקב אחרי הפגישה', 0, false],
        ['להזכיר על המקדמה', 2, false],
        ['לשלוח תמונות מהעבודות הקודמות', 4, false],
        ['שיחת היכרות', 6, false],
        ['להחזיר טלפון', -3, true],
      ];
      for (const [k, [title, days, done]] of tasks.entries()) {
        const due = zonedTimeToUtc(dayIn(tz, days), `${10 + (k % 6)}:00`, tz);
        await tx.task.create({
          data: {
            businessId: business.id,
            title,
            dueAt: due,
            status: done ? 'DONE' : 'OPEN',
            completedAt: done ? ago(2) : null,
            assigneeId: user.id,
            leadId: leads[k]!.id,
            remind: false,
            createdById: user.id,
          },
        });
      }

      // Appointments: three done this past week, eight in the coming week, two waiting for approval.
      const slots: [number, string, string, string][] = [
        [-5, '10:00', 'COMPLETED', 'manual'],
        [-3, '12:30', 'COMPLETED', 'whatsapp'],
        [-1, '16:00', 'COMPLETED', 'website'],
        [0, '18:00', 'CONFIRMED', 'manual'],
        [1, '09:30', 'CONFIRMED', 'whatsapp'],
        [1, '13:00', 'CONFIRMED', 'website'],
        [2, '11:00', 'CONFIRMED', 'manual'],
        [3, '10:00', 'REQUESTED', 'website'],
        [3, '15:30', 'CONFIRMED', 'whatsapp'],
        [5, '12:00', 'CONFIRMED', 'manual'],
        [6, '17:00', 'REQUESTED', 'whatsapp'],
      ];
      for (const [k, [days, time, status, source]] of slots.entries()) {
        const service = services[k % services.length]!;
        const startsAt = zonedTimeToUtc(openDay(days), time, tz);
        const lead = leads[(k + 3) % leads.length]!;
        await tx.appointment.create({
          data: {
            businessId: business.id,
            contactId: lead.contactId,
            leadId: lead.id,
            serviceId: service.id,
            staffId: status === 'REQUESTED' ? null : user.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + service.durationMin * 60_000),
            status: status as 'COMPLETED' | 'CONFIRMED' | 'REQUESTED',
            source,
            createdById: source === 'manual' ? user.id : null,
          },
        });
      }

      // Quotes: a draft, one sent, one accepted, one declined.
      const last = await tx.quote.aggregate({
        where: { businessId: business.id },
        _max: { number: true },
      });
      let number = (last._max.number ?? 1000) + 1;
      const quoteStates = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'] as const;
      for (const [k, status] of quoteStates.entries()) {
        const lead = leads[[0, 5, 3, 4][k]!]!;
        const items = content.items.slice(0, 2 + (k % 3)).map(([description, unitPrice], j) => ({
          description,
          quantity: j === 3 ? 2 : 1,
          unitPrice,
        }));
        await tx.quote.create({
          data: {
            businessId: business.id,
            leadId: lead.id,
            number: number++,
            title: `הצעת מחיר עבור ${lead.name}`,
            items,
            discount: k === 2 ? 20000 : 0,
            notes: 'המחיר כולל הגעה ואינו כולל מע״מ. בתוקף ל־14 יום.',
            validUntil: new Date(now.getTime() + 14 * DAY),
            status,
            publicToken: status === 'DRAFT' ? null : generateToken(),
            sentAt: status === 'DRAFT' ? null : ago(4 - k),
            decidedAt: status === 'ACCEPTED' || status === 'REJECTED' ? ago(1) : null,
            createdById: user.id,
            createdAt: ago(5 - k),
          },
        });
      }

      // WhatsApp: conversations on the WhatsApp leads, and one new number waiting in the inbox.
      const chats: [string, string][][] = [
        [
          ['IN', 'היי, ראיתי את האתר שלכם 🙂'],
          ['OUT', 'היי! שמחים שפנית, איך אפשר לעזור?'],
          ['IN', content.asks[1]!],
        ],
        [
          ['IN', 'שלום, יש זמינות בשבוע הבא?'],
          ['OUT', 'בטח, איזה יום נוח לך?'],
          ['IN', 'רביעי אחה״צ'],
          ['OUT', 'מעולה, שריינתי 👍'],
        ],
        [
          ['IN', 'אפשר הצעת מחיר?'],
          ['OUT', 'בשמחה, שולח עוד היום'],
        ],
      ];
      const waLeads = leads.filter((l) => l.source === 'whatsapp').slice(0, chats.length);
      for (const [k, lead] of waLeads.entries()) {
        const number = await tx.whatsAppNumber.create({
          data: {
            businessId: business.id,
            phone: lead.phone,
            status: 'BUSINESS',
            profileName: lead.name,
            classifiedById: user.id,
            classifiedAt: ago(3 - k),
          },
        });
        for (const [m, [direction, body]] of chats[k]!.entries()) {
          await tx.whatsAppMessage.create({
            data: {
              businessId: business.id,
              numberId: number.id,
              contactId: lead.contactId,
              leadId: lead.id,
              direction: direction as 'IN' | 'OUT',
              waMessageId: `wamid.demo-${number.id}-${m}`,
              body,
              status: direction === 'IN' ? 'received' : 'read',
              senderId: direction === 'OUT' ? user.id : null,
              createdAt: ago(3 - k, 5 - m),
            },
          });
        }
      }
      const inbox = await tx.whatsAppNumber.create({
        data: {
          businessId: business.id,
          phone: '+972500009999',
          status: 'UNCLASSIFIED',
          profileName: 'אורן',
        },
      });
      for (const [m, body] of ['היי, קיבלתי את המספר שלכם מחבר', 'אפשר לדבר מחר?'].entries()) {
        await tx.whatsAppMessage.create({
          data: {
            businessId: business.id,
            numberId: inbox.id,
            direction: 'IN',
            waMessageId: `wamid.demo-${inbox.id}-${m}`,
            body,
            status: 'received',
            createdAt: ago(0, 2 - m),
          },
        });
      }

      console.log(
        `Added to "${business.name}": ${leads.length} leads, ${tasks.length} tasks, ` +
          `${slots.length} appointments, ${quoteStates.length} quotes, ${waLeads.length + 1} WhatsApp conversations` +
          (services.length ? `, services: ${services.map((s) => s.name).join(', ')}` : ''),
      );
    },
    { timeout: 60_000 },
  );
}

main()
  .catch((err) => {
    console.error(process.env.SEED_DEBUG ? err : (err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
