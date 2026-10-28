import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiPaths } from '@leadflow/shared';
import { createTestApp, csrfHeaders, resetDb, TEST_WEB_ORIGIN } from '../../../test/helpers';
import { addMember, newUser, ownerWithBusiness, req } from '../../../test/business-helpers';

const qp = apiPaths.quotes;
const body = (leadId: string, over: object = {}) => ({
  leadId,
  title: 'שיפוץ מטבח',
  items: [
    { description: 'פירוק', quantity: 1, unitPrice: 150000 },
    { description: 'אריחים (מ״ר)', quantity: 12, unitPrice: 12050 },
  ],
  discount: 10000,
  vatRate: 18,
  notes: 'כולל פינוי פסולת',
  ...over,
});

describe('quotes (F18)', () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.email.clear();
  });

  async function setup() {
    const o = await ownerWithBusiness(ctx.app);
    const id = o.business.id;
    const lead = (
      await req(ctx.app, 'POST', apiPaths.leads.list(id), o.token, {
        name: 'רון לוי',
        phone: '052-1112233',
        email: 'ron@example.com',
      })
    ).json().lead;
    return { o, id, lead };
  }
  const pub = (method: 'GET' | 'POST', url: string, payload?: object) =>
    ctx.app.inject({
      method,
      url,
      headers: { origin: TEST_WEB_ORIGIN, ...csrfHeaders },
      ...(payload ? { payload } : {}),
    });

  it('creates numbered drafts with server totals (discount, then VAT, in agorot)', async () => {
    const { o, id, lead } = await setup();
    const res = await req(ctx.app, 'POST', qp.list(id), o.token, body(lead.id));
    expect(res.statusCode).toBe(201);
    const q = res.json().quote;
    // 1500 + 12×120.50 = 2946 ₪; −100 = 2846; VAT 18% = 512.28 → 3358.28
    expect(q).toMatchObject({
      number: 1001,
      status: 'DRAFT',
      publicUrl: null,
      totals: { subtotal: 294600, discount: 10000, vat: 51228, total: 335828 },
      customer: { name: 'רון לוי' },
    });
    const second = (await req(ctx.app, 'POST', qp.list(id), o.token, body(lead.id))).json().quote;
    expect(second.number).toBe(1002);

    const noVat = (
      await req(ctx.app, 'POST', qp.list(id), o.token, body(lead.id, { vatRate: 0, discount: 0 }))
    ).json().quote;
    expect(noVat.totals).toEqual({ subtotal: 294600, discount: 0, vat: 0, total: 294600 });

    const bad = await req(
      ctx.app,
      'POST',
      qp.list(id),
      o.token,
      body(lead.id, { discount: 9_999_999 }),
    );
    expect(bad.statusCode).toBe(400);
    expect(JSON.stringify(bad.json())).toContain('ההנחה');
    const lead1 = (await req(ctx.app, 'GET', apiPaths.leads.detail(id, lead.id), o.token)).json();
    expect(lead1.activities[0]).toMatchObject({ type: 'quote.created', data: { number: 1003 } });
  });

  it('send → customer page → accept: status, history and team email; drafts stay private', async () => {
    const { o, id, lead } = await setup();
    const q = (await req(ctx.app, 'POST', qp.list(id), o.token, body(lead.id))).json().quote;
    ctx.email.clear(); // drop the sign-up verification email
    const sent = (await req(ctx.app, 'POST', qp.send(id, q.id), o.token, { email: true })).json()
      .quote;
    expect(sent.status).toBe('SENT');
    expect(sent.publicUrl).toMatch(/\/q\/[A-Za-z0-9_-]{43}$/);
    expect(ctx.email.sent.map((m) => m.to)).toEqual(['ron@example.com']);
    expect(ctx.email.sent[0]!.text).toContain(sent.publicUrl);
    expect(ctx.email.sent[0]!.text).toContain('3,358.28');

    // A sent quote can't be edited; duplicate makes a new draft.
    expect((await req(ctx.app, 'PUT', qp.quote(id, q.id), o.token, body(lead.id))).statusCode).toBe(
      409,
    );
    const copy = (await req(ctx.app, 'POST', qp.duplicate(id, q.id), o.token)).json().quote;
    expect(copy).toMatchObject({ status: 'DRAFT', number: 1002, publicUrl: null });

    const token = sent.publicUrl.split('/').pop();
    const page = await pub('GET', qp.publicQuote(token));
    expect(page.statusCode).toBe(200);
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.json().quote).toMatchObject({
      number: 1001,
      customerName: 'רון לוי',
      totals: { total: 335828 },
      status: 'SENT',
    });
    expect(JSON.stringify(page.json())).not.toContain(lead.id);

    ctx.email.clear();
    const accept = await pub('POST', qp.publicDecision(token), { decision: 'accept' });
    expect(accept.json().quote.status).toBe('ACCEPTED');
    await expect.poll(() => ctx.email.sent.length).toBe(1);
    expect(ctx.email.sent[0]!.subject).toContain('אישר/ה');
    // A second answer is refused.
    expect((await pub('POST', qp.publicDecision(token), { decision: 'reject' })).statusCode).toBe(
      409,
    );
    const detail = (await req(ctx.app, 'GET', apiPaths.leads.detail(id, lead.id), o.token)).json();
    expect(detail.activities[0]).toMatchObject({ type: 'quote.accepted', actor: null });

    expect((await pub('GET', qp.publicQuote('x'.repeat(43)))).statusCode).toBe(404);
  });

  it("expired quotes show as expired and can't be accepted", async () => {
    const { o, id, lead } = await setup();
    const q = (
      await req(ctx.app, 'POST', qp.list(id), o.token, body(lead.id, { validUntil: '2020-01-01' }))
    ).json().quote;
    const sent = (await req(ctx.app, 'POST', qp.send(id, q.id), o.token, { email: false })).json()
      .quote;
    expect(sent.expired).toBe(true);
    const token = sent.publicUrl.split('/').pop();
    const res = await pub('POST', qp.publicDecision(token), { decision: 'accept' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/תוקף/);
  });

  it('emailing a customer without an email is refused; the business can record a decision', async () => {
    const { o, id } = await setup();
    const noMail = (
      await req(ctx.app, 'POST', apiPaths.leads.list(id), o.token, {
        name: 'דנה',
        phone: '052-0000009',
      })
    ).json().lead;
    const q = (await req(ctx.app, 'POST', qp.list(id), o.token, body(noMail.id))).json().quote;
    expect(
      (await req(ctx.app, 'POST', qp.send(id, q.id), o.token, { email: true })).statusCode,
    ).toBe(400);
    const rejected = await req(ctx.app, 'POST', qp.decide(id, q.id), o.token, {
      status: 'REJECTED',
    });
    expect(rejected.json().quote.status).toBe('REJECTED');
    // Only drafts can be deleted.
    expect((await req(ctx.app, 'DELETE', qp.quote(id, q.id), o.token)).statusCode).toBe(409);
  });

  it('employees only see quotes on their leads; other businesses see nothing', async () => {
    const { o, id, lead } = await setup();
    const emp = await newUser(ctx.app, 'emp');
    await addMember(ctx.prisma, id, emp.userId, 'EMPLOYEE');
    const q = (await req(ctx.app, 'POST', qp.list(id), o.token, body(lead.id))).json().quote;
    expect((await req(ctx.app, 'GET', qp.list(id), emp.token)).json().quotes).toEqual([]);
    expect((await req(ctx.app, 'GET', qp.quote(id, q.id), emp.token)).statusCode).toBe(404);
    expect((await req(ctx.app, 'POST', qp.list(id), emp.token, body(lead.id))).statusCode).toBe(
      400,
    );

    await req(ctx.app, 'PATCH', apiPaths.leads.detail(id, lead.id), o.token, {
      ownerId: emp.userId,
    });
    expect((await req(ctx.app, 'GET', qp.list(id), emp.token)).json().quotes).toHaveLength(1);

    const other = await ownerWithBusiness(ctx.app, 'other');
    expect(
      (await req(ctx.app, 'GET', qp.quote(other.business.id, q.id), other.token)).statusCode,
    ).toBe(404);
    expect(
      (await req(ctx.app, 'POST', qp.list(other.business.id), other.token, body(lead.id)))
        .statusCode,
    ).toBe(400);
  });
});
