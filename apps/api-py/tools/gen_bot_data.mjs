// Generates app/shared/data/bot_texts.json: the WhatsApp bot's default texts per industry and
// language, from the TypeScript originals. Run from the repo root:  npx tsx apps/api-py/tools/gen_bot_data.mjs
import { writeFileSync } from 'node:fs';
import {
  INDUSTRIES,
  botDefaultTextsFor,
  botFlowFor,
  asksGuests,
  eventTypesFor,
  eventTypeQuestionFor,
  showcaseDefaultText,
  statusPresetsFor,
  autoReplyDefaultFor,
} from '../../../packages/shared/src/index.ts';

const keys = [...INDUSTRIES, '_other'];
const per = (lang) => ({
  defaults: Object.fromEntries(keys.map((i) => [i, botDefaultTextsFor(i, lang)])),
  showcase: Object.fromEntries(keys.map((i) => [i, showcaseDefaultText(i, lang)])),
  eventTypes: Object.fromEntries(keys.map((i) => [i, eventTypesFor(i, lang)])),
  eventTypeQuestion: Object.fromEntries(keys.map((i) => [i, eventTypeQuestionFor(i, lang)])),
  statusPresets: statusPresetsFor(lang).map((p) => ({ ...p })),
  autoReply: autoReplyDefaultFor(lang),
});
const data = {
  industries: INDUSTRIES,
  flow: Object.fromEntries(keys.map((i) => [i, botFlowFor(i)])),
  asksGuests: Object.fromEntries(keys.map((i) => [i, asksGuests(i)])),
  he: per('he'),
  en: per('en'),
};
const out = new URL('../../api-py/app/shared/data/bot_texts.json', import.meta.url).pathname;
writeFileSync(out, JSON.stringify(data, null, 1) + '\n');
