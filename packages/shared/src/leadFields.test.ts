import { describe, expect, it } from 'vitest';
import {
  applyCustomFieldsPatch,
  createLeadCustomFieldsOptions,
  buildCustomFieldsSchema,
  createLeadFieldRequestSchema,
  diffCustomFields,
  hasInvalidCharacters,
  isValidIsoDate,
  leadFieldFilterParams,
  leadFieldMessages as m,
  parseLeadFieldFilterParams,
  reorderLeadFieldsRequestSchema,
  updateLeadFieldRequestSchema,
  validateCustomFields,
  type LeadFieldRule,
} from './leadFields';
import { createLeadRequestSchema, leadSchema, updateLeadRequestSchema } from './leads';
import { can } from './permissions';

const ids = {
  text: '11111111-1111-4111-8111-111111111111',
  number: '22222222-2222-4222-8222-222222222222',
  date: '33333333-3333-4333-8333-333333333333',
  select: '44444444-4444-4444-8444-444444444444',
  boolean: '55555555-5555-4555-8555-555555555555',
  archived: '66666666-6666-4666-8666-666666666666',
  foreign: '77777777-7777-4777-8777-777777777777',
};
const ARCHIVED_AT = '2026-11-01T10:00:00.000Z';

const base = { required: false, min: null, max: null, archivedAt: null, options: [] };
const rules: LeadFieldRule[] = [
  { ...base, id: ids.text, type: 'text', required: true },
  { ...base, id: ids.number, type: 'number', min: 0, max: 500 },
  { ...base, id: ids.date, type: 'date' },
  {
    ...base,
    id: ids.select,
    type: 'select',
    options: [
      { id: 'opt-a', archivedAt: null },
      { id: 'opt-b', archivedAt: null },
      { id: 'opt-old', archivedAt: ARCHIVED_AT },
    ],
  },
  { ...base, id: ids.boolean, type: 'boolean' },
  { ...base, id: ids.archived, type: 'text', required: true, archivedAt: ARCHIVED_AT },
];

const hebrew = /[֐-׿]/;

describe('field definition requests', () => {
  it('creates a select field with trimmed labels and drops range/options by type', () => {
    expect(
      createLeadFieldRequestSchema.parse({
        label: '  סוג טיפול ',
        type: 'select',
        options: [{ label: ' פנים ' }, { label: 'גוף' }],
      }),
    ).toEqual({
      label: 'סוג טיפול',
      type: 'select',
      options: [{ label: 'פנים' }, { label: 'גוף' }],
      required: false,
      min: null,
      max: null,
    });
    expect(
      createLeadFieldRequestSchema.parse({ label: 'אורחים', type: 'number', min: 1, max: 1000 }),
    ).toMatchObject({ options: [], min: 1, max: 1000 });
  });

  it.each([
    [{ label: '', type: 'text' }, 'label', m.labelRequired],
    [{ label: 'א'.repeat(41), type: 'text' }, 'label', m.labelTooLong],
    [{ label: 'x', type: 'color' }, 'type', m.typeInvalid],
    [{ label: 'x', type: 'select' }, 'options', m.optionsCount],
    [{ label: 'x', type: 'select', options: [{ label: 'a' }] }, 'options', m.optionsCount],
    [
      {
        label: 'x',
        type: 'select',
        options: Array.from({ length: 31 }, (_, i) => ({ label: `${i}` })),
      },
      'options',
      m.optionsCount,
    ],
    [
      { label: 'x', type: 'select', options: [{ label: 'a' }, { label: 'b'.repeat(61) }] },
      'options',
      m.optionLabelTooLong,
    ],
    [
      { label: 'x', type: 'select', options: [{ label: 'Yes' }, { label: ' yes' }] },
      'options',
      m.optionDuplicate,
    ],
    [
      { label: 'x', type: 'text', options: [{ label: 'a' }, { label: 'b' }] },
      'options',
      m.optionsNotAllowed,
    ],
    [{ label: 'x', type: 'text', min: 1 }, 'min', m.rangeNotAllowed],
    [{ label: 'x', type: 'number', min: 5, max: 1 }, 'min', m.rangeInvalid],
    [{ label: 'x', type: 'boolean', required: true }, 'required', m.booleanNotRequired],
  ])('refuses %j on %s with a Hebrew message', (input, field, message) => {
    const r = createLeadFieldRequestSchema.safeParse(input);
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path[0] === field);
    expect(issue?.message).toBe(message);
    expect(issue?.message).toMatch(hebrew);
  });

  it('update never accepts a type, and keeps option ids', () => {
    const r = updateLeadFieldRequestSchema.safeParse({ label: 'חדש', type: 'number' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({ path: ['type'], message: m.typeLocked });

    const ok = updateLeadFieldRequestSchema.parse({
      label: ' חדש ',
      options: [{ id: 'opt-a', label: 'א' }, { label: 'ב' }],
      archived: true,
    });
    expect(ok).toEqual({
      label: 'חדש',
      options: [{ id: 'opt-a', label: 'א' }, { label: 'ב' }],
      archived: true,
    });
    expect('type' in ok).toBe(false);
    expect(updateLeadFieldRequestSchema.parse({})).toEqual({});
  });

  it('reorder needs unique uuids', () => {
    expect(reorderLeadFieldsRequestSchema.safeParse({ ids: [ids.text, ids.date] }).success).toBe(
      true,
    );
    const dup = reorderLeadFieldsRequestSchema.safeParse({ ids: [ids.text, ids.text] });
    expect(dup.error?.issues[0]?.message).toBe(m.orderDuplicate);
    expect(reorderLeadFieldsRequestSchema.safeParse({ ids: ['nope'] }).success).toBe(false);
  });

  it('only owners and managers manage fields', () => {
    expect(can('OWNER', 'leadFields.manage')).toBe(true);
    expect(can('MANAGER', 'leadFields.manage')).toBe(true);
    expect(can('EMPLOYEE', 'leadFields.manage')).toBe(false);
  });
});

describe('validateCustomFields', () => {
  const app = { mode: 'create', fromApp: true } as const;
  const external = { mode: 'create', fromApp: false } as const;

  it('normalises every type and drops empty values on create', () => {
    const r = validateCustomFields(
      rules,
      {
        [ids.text]: '  שורה\nשנייה  ',
        [ids.number]: '12.5',
        [ids.date]: '2027-02-28',
        [ids.select]: 'opt-b',
        [ids.boolean]: false,
      },
      app,
    );
    expect(r).toEqual({
      ok: true,
      values: {
        [ids.text]: 'שורה שנייה',
        [ids.number]: 12.5,
        [ids.date]: '2027-02-28',
        [ids.select]: 'opt-b',
      },
    });
    expect(
      validateCustomFields(rules, { [ids.text]: 'x', [ids.boolean]: true, [ids.date]: '' }, app),
    ).toEqual({
      ok: true,
      values: { [ids.text]: 'x', [ids.boolean]: true },
    });
  });

  it.each([
    [ids.foreign, 'x', m.valueUnknownField],
    ['not-a-uuid', 'x', m.valueUnknownField],
    [ids.archived, 'x', m.valueArchivedField],
    [ids.text, 42, m.valueText],
    [ids.text, 'א'.repeat(501), m.valueTextTooLong],
    [ids.number, 'abc', m.valueNumber],
    [ids.number, true, m.valueNumber],
    [ids.number, -1, m.valueNumberMin(0)],
    [ids.number, 501, m.valueNumberMax(500)],
    [ids.number, 1e13, m.valueNumber],
    [ids.date, '2027-02-30', m.valueDate],
    [ids.date, '27/02/2027', m.valueDate],
    [ids.select, 'opt-zzz', m.valueOption],
    [ids.select, 'opt-old', m.valueOption],
    [ids.boolean, 'true', m.valueBoolean],
  ])('refuses %s = %j per field', (key, value, message) => {
    const r = validateCustomFields(rules, { [ids.text]: 'ok', [key]: value }, external);
    expect(r).toEqual({ ok: false, fields: { [`customFields.${key}`]: message } });
    expect(message).toMatch(hebrew);
  });

  it('enforces required only for edits in the app', () => {
    expect(validateCustomFields(rules, {}, app)).toEqual({
      ok: false,
      fields: { [`customFields.${ids.text}`]: m.valueRequired },
    });
    expect(validateCustomFields(rules, { [ids.text]: '   ' }, app)).toEqual({
      ok: false,
      fields: { [`customFields.${ids.text}`]: m.valueRequired },
    });
    // Archived required fields are never demanded; external sources never need required ones.
    expect(validateCustomFields(rules, {}, external)).toEqual({ ok: true, values: {} });
    expect(validateCustomFields(rules, undefined, external)).toEqual({ ok: true, values: {} });
  });

  it('update returns a patch: null removes, required can not be cleared in the app', () => {
    const existing = { [ids.text]: 'ישן', [ids.number]: 3 };
    expect(
      validateCustomFields(
        rules,
        { [ids.number]: null, [ids.date]: '2027-01-01' },
        {
          mode: 'update',
          fromApp: true,
          existing,
        },
      ),
    ).toEqual({ ok: true, values: { [ids.number]: null, [ids.date]: '2027-01-01' } });
    expect(
      validateCustomFields(rules, { [ids.text]: '' }, { mode: 'update', fromApp: true, existing }),
    ).toEqual({ ok: false, fields: { [`customFields.${ids.text}`]: m.valueRequired } });
    // A patch that doesn't touch a required field doesn't need it, even if the lead lacks it.
    expect(
      validateCustomFields(rules, { [ids.date]: '2027-01-01' }, { mode: 'update', fromApp: true }),
    ).toEqual({ ok: true, values: { [ids.date]: '2027-01-01' } });
  });

  it('a stored value sent back unchanged passes even when archived since', () => {
    const existing = { [ids.archived]: 'ערך ישן', [ids.select]: 'opt-old' };
    const opts = { mode: 'update', fromApp: true, existing } as const;
    expect(validateCustomFields(rules, existing, opts)).toEqual({ ok: true, values: existing });
    expect(validateCustomFields(rules, { [ids.archived]: 'שונה' }, opts).ok).toBe(false);
    expect(validateCustomFields(rules, { [ids.archived]: null }, opts).ok).toBe(false);
    expect(validateCustomFields(rules, { [ids.select]: 'opt-a' }, opts)).toEqual({
      ok: true,
      values: { [ids.select]: 'opt-a' },
    });
  });

  it('refuses a non-object and too many keys', () => {
    expect(validateCustomFields(rules, [], external)).toEqual({
      ok: false,
      fields: { customFields: m.valuesInvalid },
    });
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, 'x']));
    expect(validateCustomFields(rules, many, external)).toEqual({
      ok: false,
      fields: { customFields: m.tooManyValues },
    });
  });

  it('works as a Zod schema with paths relative to customFields', () => {
    const schema = buildCustomFieldsSchema(rules, app);
    const r = schema.safeParse({ [ids.text]: 'x', [ids.select]: 'nope' });
    expect(r.success).toBe(false);
    expect(r.error!.issues).toMatchObject([{ path: [ids.select], message: m.valueOption }]);
    expect(schema.parse({ [ids.text]: 'x' })).toEqual({ [ids.text]: 'x' });
  });

  it('applies a patch and diffs values for the history', () => {
    const before = { [ids.text]: 'a', [ids.number]: 3 };
    const after = applyCustomFieldsPatch(before, { [ids.number]: null, [ids.select]: 'opt-a' });
    expect(after).toEqual({ [ids.text]: 'a', [ids.select]: 'opt-a' });
    expect(diffCustomFields(before, after)).toEqual([
      { fieldId: ids.select, from: null, to: 'opt-a' },
      { fieldId: ids.number, from: 3, to: null },
    ]);
    expect(diffCustomFields(after, after)).toEqual([]);
  });

  it('checks calendar dates', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2027-02-29')).toBe(false);
    expect(isValidIsoDate('2027-13-01')).toBe(false);
  });
});

describe('list filters', () => {
  it('round-trips cf[...] params and ignores other or empty ones', () => {
    const params = leadFieldFilterParams({
      [ids.text]: { value: 'מרצדס' },
      [ids.number]: { from: '10', to: '' },
      [ids.date]: { to: '2027-01-31' },
    });
    expect(params).toEqual([
      [`cf[${ids.text}]`, 'מרצדס'],
      [`cf[${ids.number}][from]`, '10'],
      [`cf[${ids.date}][to]`, '2027-01-31'],
    ]);
    const parsed = parseLeadFieldFilterParams(
      new URLSearchParams([...params, ['q', 'x'], ['cf[nope]', 'y'], [`cf[${ids.select}]`, ' ']]),
    );
    expect(parsed).toEqual({
      [ids.text]: { value: 'מרצדס' },
      [ids.number]: { from: '10' },
      [ids.date]: { to: '2027-01-31' },
    });
  });
});

describe('characters Postgres cannot store', () => {
  const NUL = '\u0000';
  const LONE_HIGH = '\uD83D';
  const LONE_LOW = '\uDE00';

  it('detects NUL and lone surrogates, not emoji or Hebrew', () => {
    expect(hasInvalidCharacters(`a${NUL}b`)).toBe(true);
    expect(hasInvalidCharacters(`a${LONE_HIGH}`)).toBe(true);
    expect(hasInvalidCharacters(`${LONE_LOW}a`)).toBe(true);
    expect(hasInvalidCharacters(`${LONE_LOW}${LONE_HIGH}`)).toBe(true);
    expect(hasInvalidCharacters('אורחים 😀')).toBe(false);
    expect(m.invalidCharacters).toMatch(hebrew);
  });

  it.each([NUL, LONE_HIGH, LONE_LOW])('refuses %j in labels and option labels', (bad) => {
    const label = createLeadFieldRequestSchema.safeParse({ label: `שם${bad}`, type: 'text' });
    expect(label.error?.issues).toMatchObject([{ path: ['label'], message: m.invalidCharacters }]);

    const option = createLeadFieldRequestSchema.safeParse({
      label: 'סוג',
      type: 'select',
      options: [{ label: 'א' }, { label: `ב${bad}` }],
    });
    expect(option.error?.issues).toMatchObject([
      { path: ['options', 1, 'label'], message: m.invalidCharacters },
    ]);

    const update = updateLeadFieldRequestSchema.safeParse({
      label: bad,
      options: [{ id: 'opt-a', label: 'א' }, { label: `ב${bad}` }],
    });
    expect(update.error?.issues.map((i) => [i.path.join('.'), i.message])).toEqual([
      ['label', m.invalidCharacters],
      ['options.1.label', m.invalidCharacters],
    ]);
  });

  it.each([NUL, LONE_HIGH, LONE_LOW])('refuses %j in a text value', (bad) => {
    expect(
      validateCustomFields(rules, { [ids.text]: `טקסט${bad}` }, { mode: 'create', fromApp: false }),
    ).toEqual({ ok: false, fields: { [`customFields.${ids.text}`]: m.invalidCharacters } });
  });

  it('drops filter values with invalid characters', () => {
    expect(
      leadFieldFilterParams({ [ids.text]: { value: `a${NUL}` }, [ids.number]: { from: '1' } }),
    ).toEqual([[`cf[${ids.number}][from]`, '1']]);
    expect(
      parseLeadFieldFilterParams([
        [`cf[${ids.text}]`, `a${LONE_HIGH}`],
        [`cf[${ids.date}][to]`, `2027-01-01${NUL}`],
        [`cf[${ids.select}]`, 'opt-a'],
      ]),
    ).toEqual({ [ids.select]: { value: 'opt-a' } });
  });
});

describe('options on create', () => {
  it.each(['text', 'number', 'date', 'boolean'] as const)('accepts options: [] for %s', (type) => {
    expect(createLeadFieldRequestSchema.parse({ label: 'x', type, options: [] }).options).toEqual(
      [],
    );
  });

  it('select still needs 2–30 options', () => {
    const empty = createLeadFieldRequestSchema.safeParse({
      label: 'x',
      type: 'select',
      options: [],
    });
    expect(empty.error?.issues).toMatchObject([{ path: ['options'], message: m.optionsCount }]);
    expect(
      updateLeadFieldRequestSchema.safeParse({ options: [{ label: 'a' }] }).error?.issues[0]
        ?.message,
    ).toBe(m.optionsCount);
  });
});

describe('quick add skips required fields (D-205)', () => {
  const lead = { name: 'דנה', phone: '050-1234567' };

  it('the flag is optional and defaults to enforcing required fields', () => {
    const full = createLeadRequestSchema.parse(lead);
    expect(full.skipRequiredCustomFields).toBe(false);
    expect(createLeadCustomFieldsOptions(full)).toEqual({ mode: 'create', fromApp: true });
    expect(createLeadCustomFieldsOptions({})).toEqual({ mode: 'create', fromApp: true });
    expect(
      validateCustomFields(rules, full.customFields, createLeadCustomFieldsOptions(full)),
    ).toEqual({
      ok: false,
      fields: { [`customFields.${ids.text}`]: m.valueRequired },
    });
  });

  it('quick add creates without required values but still checks what is sent', () => {
    const quick = createLeadRequestSchema.parse({ ...lead, skipRequiredCustomFields: true });
    const opts = createLeadCustomFieldsOptions(quick);
    expect(opts).toEqual({ mode: 'create', fromApp: false });
    expect(validateCustomFields(rules, quick.customFields, opts)).toEqual({ ok: true, values: {} });
    expect(validateCustomFields(rules, { [ids.select]: 'nope', [ids.foreign]: 'x' }, opts)).toEqual(
      {
        ok: false,
        fields: {
          [`customFields.${ids.select}`]: m.valueOption,
          [`customFields.${ids.foreign}`]: m.valueUnknownField,
        },
      },
    );
    expect(buildCustomFieldsSchema(rules, opts).safeParse({ [ids.number]: 3 }).success).toBe(true);
  });

  it('refuses a non-boolean flag', () => {
    expect(
      createLeadRequestSchema.safeParse({ ...lead, skipRequiredCustomFields: 'yes' }).success,
    ).toBe(false);
  });
});

describe('leads with custom fields (backward compatible)', () => {
  it('create defaults customFields to {}; update leaves it absent', () => {
    const created = createLeadRequestSchema.parse({ name: 'דנה', phone: '050-1234567' });
    expect(created.customFields).toEqual({});
    expect(
      createLeadRequestSchema.parse({
        name: 'דנה',
        phone: '050-1234567',
        customFields: { [ids.text]: 'x', [ids.number]: null },
      }).customFields,
    ).toEqual({ [ids.text]: 'x', [ids.number]: null });
    expect('customFields' in updateLeadRequestSchema.parse({ tags: [] })).toBe(false);
    expect(
      updateLeadRequestSchema.safeParse({ customFields: { [ids.text]: { nested: 1 } } }).success,
    ).toBe(false);
  });

  it('a lead without customFields still parses', () => {
    const lead = {
      id: ids.text,
      contact: { id: ids.text, name: 'דנה', phone: null, email: null },
      stage: { id: ids.text, name: 'חדש', kind: 'OPEN' },
      source: 'manual',
      sourceUrl: null,
      message: null,
      owner: null,
      value: { won: 0, open: 0 },
      nextTask: null,
      tags: [],
      createdAt: ARCHIVED_AT,
      updatedAt: ARCHIVED_AT,
    };
    expect(leadSchema.parse(lead).customFields).toBeUndefined();
    expect(leadSchema.parse({ ...lead, customFields: { [ids.number]: 4 } }).customFields).toEqual({
      [ids.number]: 4,
    });
  });
});
