import { describe, expect, it } from 'vitest';
import {
  appointmentConfirmDueAt,
  autoTaskTitles,
  createTaskRequestSchema,
  quoteFollowUpDueAt,
  taskListQuerySchema,
  taskMessages,
  taskSchema,
  updateTaskRequestSchema,
} from './tasks';
import { addDays, weekdayOf } from './time';
import { leadDetailResponseSchema, MAX_RELATED_LEADS } from './leads';

const Q = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const TZ = 'Asia/Jerusalem';

describe('task subject (F35, D-213)', () => {
  const base = { title: 'לחזור ללקוח', dueAt: '2026-12-01T07:00:00.000Z' };

  it('accepts a quote or an appointment, not both', () => {
    expect(createTaskRequestSchema.safeParse({ ...base, quoteId: Q }).success).toBe(true);
    expect(createTaskRequestSchema.safeParse({ ...base, appointmentId: A }).success).toBe(true);
    const both = createTaskRequestSchema.safeParse({ ...base, quoteId: Q, appointmentId: A });
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]).toMatchObject({
      message: taskMessages.subjectBoth,
      path: ['appointmentId'],
    });
  });

  it('lets an update unlink one and set the other in the same request', () => {
    expect(updateTaskRequestSchema.safeParse({ quoteId: null, appointmentId: A }).success).toBe(
      true,
    );
    expect(updateTaskRequestSchema.safeParse({ quoteId: null, appointmentId: null }).success).toBe(
      true,
    );
    expect(updateTaskRequestSchema.safeParse({ quoteId: Q, appointmentId: A }).success).toBe(false);
    expect(updateTaskRequestSchema.safeParse({ quoteId: 'nope' }).success).toBe(false);
  });

  it('filters the list by quote or appointment', () => {
    expect(taskListQuerySchema.parse({ quoteId: Q })).toEqual({ quoteId: Q });
    expect(taskListQuerySchema.safeParse({ appointmentId: 'x' }).success).toBe(false);
  });

  it('reads a subject as a quote number or an appointment start, and old payloads still parse', () => {
    const task = {
      id: Q,
      title: 'לחזור לגבי הצעה #12',
      notes: null,
      dueAt: '2026-12-01T07:00:00.000Z',
      status: 'OPEN',
      remind: true,
      completedAt: null,
      assignee: { id: A, name: 'דנה' },
      lead: null,
      createdAt: '2026-11-28T10:00:00.000Z',
    };
    expect(taskSchema.safeParse(task).success).toBe(true);
    expect(
      taskSchema.safeParse({
        ...task,
        autoKind: 'quote_followup',
        subject: { kind: 'quote', id: Q, number: 12, status: 'SENT' },
      }).success,
    ).toBe(true);
    expect(
      taskSchema.safeParse({
        ...task,
        autoKind: 'appointment_confirm',
        subject: {
          kind: 'appointment',
          id: A,
          startsAt: '2026-12-02T08:00:00.000Z',
          status: 'CONFIRMED',
        },
      }).success,
    ).toBe(true);
    expect(
      taskSchema.safeParse({ ...task, subject: { kind: 'quote', id: Q, startsAt: 'x' } }).success,
    ).toBe(false);
    expect(taskSchema.safeParse({ ...task, autoKind: 'other' }).success).toBe(false);
  });

  it('titles automatic tasks in the business language', () => {
    expect(autoTaskTitles.he.quote_followup(12)).toBe('לחזור לגבי הצעה #12');
    expect(autoTaskTitles.en.appointment_confirm()).toBe('Confirm the appointment');
    // D-216 (2): the customer's own booking keeps its details in the title.
    expect(autoTaskTitles.he.appointment_confirm('דנה · תספורת')).toBe(
      'לאשר את הפגישה: דנה · תספורת',
    );
    expect(autoTaskTitles.en.appointment_confirm('Dana · Haircut')).toBe(
      'Confirm the appointment: Dana · Haircut',
    );
  });
});

describe('automatic follow-up timing (D-214)', () => {
  it('quote follow-up: 09:00 business time, two calendar days after the send day', () => {
    // Sunday 2026-11-29 18:30 in Israel (UTC+2) → Tuesday 2026-12-01 09:00 = 07:00Z.
    expect(quoteFollowUpDueAt(new Date('2026-11-29T16:30:00Z'), TZ).toISOString()).toBe(
      '2026-12-01T07:00:00.000Z',
    );
    // 23:30Z on the 29th is already the 30th in Israel → 2 Dec 09:00.
    expect(quoteFollowUpDueAt(new Date('2026-11-29T23:30:00Z'), TZ).toISOString()).toBe(
      '2026-12-02T07:00:00.000Z',
    );
    // Summer time (UTC+3).
    expect(quoteFollowUpDueAt(new Date('2026-07-10T09:00:00Z'), TZ).toISOString()).toBe(
      '2026-07-12T06:00:00.000Z',
    );
  });

  it('appointment confirm: 09:00 the day before, or now when that has passed', () => {
    const start = new Date('2026-12-03T12:00:00Z'); // Thursday 14:00 in Israel
    const booked = new Date('2026-11-28T10:00:00Z');
    expect(appointmentConfirmDueAt(start, booked, TZ)?.toISOString()).toBe(
      '2026-12-02T07:00:00.000Z',
    );
    // Booked the evening before: 09:00 has passed → due now.
    const late = new Date('2026-12-02T18:00:00Z');
    expect(appointmentConfirmDueAt(start, late, TZ)?.toISOString()).toBe(late.toISOString());
  });

  it('appointment confirm: no task for an appointment today or in the past', () => {
    const now = new Date('2026-12-03T06:00:00Z'); // 08:00 in Israel
    expect(appointmentConfirmDueAt(new Date('2026-12-03T15:00:00Z'), now, TZ)).toBeNull();
    expect(appointmentConfirmDueAt(new Date('2026-12-01T15:00:00Z'), now, TZ)).toBeNull();
    // 22:30Z is already the 4th in Israel → a task, due today at 09:00 (still ahead).
    expect(appointmentConfirmDueAt(new Date('2026-12-03T22:30:00Z'), now, TZ)?.toISOString()).toBe(
      '2026-12-03T07:00:00.000Z',
    );
  });

  it('moves calendar days across month and year ends, and knows the weekday', () => {
    expect(addDays('2026-12-31', 2)).toBe('2027-01-02');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(weekdayOf('2026-12-04')).toBe(5); // Friday
    expect(weekdayOf('2026-12-06')).toBe(0); // Sunday
  });
});

describe('weekend rule (D-216)', () => {
  const due = (sent: string) => quoteFollowUpDueAt(new Date(sent), TZ).toISOString();
  const confirm = (start: string, now = '2026-11-30T08:00:00Z') =>
    appointmentConfirmDueAt(new Date(start), new Date(now), TZ)?.toISOString();

  it('quote follow-up landing on Friday or Saturday moves to Sunday 09:00', () => {
    expect(due('2026-12-02T10:00:00Z')).toBe('2026-12-06T07:00:00.000Z'); // Wed → Fri → Sun
    expect(due('2026-12-03T10:00:00Z')).toBe('2026-12-06T07:00:00.000Z'); // Thu → Sat → Sun
    expect(due('2026-12-04T10:00:00Z')).toBe('2026-12-06T07:00:00.000Z'); // Fri → Sun (no shift)
  });

  it('quote follow-up across a daylight-saving switch', () => {
    // Thu 22 Oct 2026 → Sat 24 → Sun 25 Oct, the day summer time ends: 09:00 is UTC+2.
    expect(due('2026-10-22T12:00:00Z')).toBe('2026-10-25T07:00:00.000Z');
    // Wed 24 Mar 2027 (UTC+2) → Fri 26, the day summer time starts → Sun 28 Mar 09:00 at UTC+3.
    expect(due('2027-03-24T12:00:00Z')).toBe('2027-03-28T06:00:00.000Z');
  });

  it('appointment on Friday: the day before is Thursday, no shift', () => {
    expect(confirm('2026-12-04T12:00:00Z')).toBe('2026-12-03T07:00:00.000Z');
  });

  it('appointment on Saturday: Sunday would be after it, so Thursday 09:00', () => {
    expect(confirm('2026-12-05T18:00:00Z')).toBe('2026-12-03T07:00:00.000Z');
  });

  it('appointment on Sunday: Sunday 09:00 if it starts later, else Thursday 09:00', () => {
    expect(confirm('2026-12-06T12:00:00Z')).toBe('2026-12-06T07:00:00.000Z'); // 14:00
    expect(confirm('2026-12-06T06:30:00Z')).toBe('2026-12-03T07:00:00.000Z'); // 08:30
    expect(confirm('2026-12-06T07:00:00Z')).toBe('2026-12-03T07:00:00.000Z'); // exactly 09:00
  });

  it('appointment on Monday: the day before is Sunday, no shift', () => {
    expect(confirm('2026-12-07T12:00:00Z')).toBe('2026-12-06T07:00:00.000Z');
  });

  it('a shifted time already past is due now', () => {
    // Booked Friday for Saturday evening: Thursday 09:00 has passed.
    expect(confirm('2026-12-05T18:00:00Z', '2026-12-04T10:00:00Z')).toBe(
      '2026-12-04T10:00:00.000Z',
    );
  });

  it('appointment confirm across a daylight-saving switch', () => {
    // Sun 25 Oct 2026 14:00 (UTC+2 after the switch): Saturday → Sunday 09:00 = 07:00Z.
    expect(confirm('2026-10-25T12:00:00Z', '2026-10-20T08:00:00Z')).toBe(
      '2026-10-25T07:00:00.000Z',
    );
    // Mon 29 Mar 2027: the day before is Sunday 28 Mar, 09:00 at UTC+3.
    expect(confirm('2027-03-29T09:00:00Z', '2027-03-20T08:00:00Z')).toBe(
      '2027-03-28T06:00:00.000Z',
    );
  });
});

describe('related leads (D-212)', () => {
  const lead = {
    id: Q,
    stage: { id: A, name: 'חדש', kind: 'OPEN' },
    createdAt: '2026-11-28T10:00:00.000Z',
    value: { won: 0, open: 1200 },
  };

  it('is optional for older payloads and capped', () => {
    expect(leadDetailResponseSchema.shape.relatedLeads.safeParse(undefined).success).toBe(true);
    expect(leadDetailResponseSchema.shape.relatedLeads.safeParse([lead]).success).toBe(true);
    expect(
      leadDetailResponseSchema.shape.relatedLeads.safeParse(
        Array.from({ length: MAX_RELATED_LEADS + 1 }, () => lead),
      ).success,
    ).toBe(false);
  });
});
