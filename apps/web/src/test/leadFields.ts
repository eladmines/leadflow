import type { LeadFieldDefinition } from '@simplecatch/shared';

/** F34 fixtures: an events business's own lead fields. */
const at = '2026-11-20T10:00:00.000Z';

export const fieldIds = {
  car: 'f1000000-0000-4000-8000-000000000001',
  guests: 'f1000000-0000-4000-8000-000000000002',
  eventDate: 'f1000000-0000-4000-8000-000000000003',
  eventType: 'f1000000-0000-4000-8000-000000000004',
  parking: 'f1000000-0000-4000-8000-000000000005',
  oldNote: 'f1000000-0000-4000-8000-000000000006',
} as const;

export const optionIds = {
  wedding: 'a1000000-0000-4000-8000-000000000001',
  barMitzvah: 'a1000000-0000-4000-8000-000000000002',
  conference: 'a1000000-0000-4000-8000-000000000003',
} as const;

const base = {
  options: [],
  required: false,
  min: null,
  max: null,
  archivedAt: null,
  createdAt: at,
  updatedAt: at,
};

export const carField: LeadFieldDefinition = {
  ...base,
  id: fieldIds.car,
  label: 'דגם הרכב',
  type: 'text',
  position: 0,
};
export const guestsField: LeadFieldDefinition = {
  ...base,
  id: fieldIds.guests,
  label: 'מספר אורחים',
  type: 'number',
  required: true,
  min: 1,
  max: 500,
  position: 1,
};
export const eventDateField: LeadFieldDefinition = {
  ...base,
  id: fieldIds.eventDate,
  label: 'תאריך האירוע',
  type: 'date',
  position: 2,
};
export const eventTypeField: LeadFieldDefinition = {
  ...base,
  id: fieldIds.eventType,
  label: 'סוג האירוע',
  type: 'select',
  position: 3,
  options: [
    { id: optionIds.wedding, label: 'חתונה', archivedAt: null },
    { id: optionIds.barMitzvah, label: 'בר מצווה', archivedAt: null },
    { id: optionIds.conference, label: 'כנס', archivedAt: at },
  ],
};
export const parkingField: LeadFieldDefinition = {
  ...base,
  id: fieldIds.parking,
  label: 'חנייה במקום',
  type: 'boolean',
  position: 4,
};
export const oldNoteField: LeadFieldDefinition = {
  ...base,
  id: fieldIds.oldNote,
  label: 'הערת מוקד',
  type: 'text',
  position: 5,
  archivedAt: at,
};

export const allFields: LeadFieldDefinition[] = [
  carField,
  guestsField,
  eventDateField,
  eventTypeField,
  parkingField,
  oldNoteField,
];
