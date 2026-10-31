/**
 * Local stand-in for Meta (F12 POC): sends a signed WhatsApp webhook event to the local API, as if
 * a customer wrote to the connected number. Needs WHATSAPP_BUSINESS_ID / _APP_SECRET in .env.
 *
 *   pnpm --filter @leadflow/api wa:simulate --from 0501234567 --name "דנה" --text "היי"
 *   pnpm --filter @leadflow/api wa:simulate --status read --id wamid.local-…
 */
import { parseArgs } from 'node:util';
import { normalizeIsraeliPhone, whatsappApiPaths } from '@leadflow/shared';
import { loadConfig } from '../src/config/env';
import { signWebhookBody } from '../src/integrations/whatsapp';

const { values } = parseArgs({
  // pnpm forwards a literal "--" separator; ignore it.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    from: { type: 'string', default: '0501234567' },
    name: { type: 'string', default: 'לקוחה לדוגמה' },
    text: { type: 'string', default: 'היי, אפשר לקבוע תור לתספורת?' },
    status: { type: 'string' },
    id: { type: 'string' },
    url: { type: 'string' },
  },
});

const config = loadConfig();
if (!config.WHATSAPP_BUSINESS_ID || !config.WHATSAPP_APP_SECRET) {
  console.error('Set WHATSAPP_BUSINESS_ID and WHATSAPP_APP_SECRET in apps/api/.env first.');
  process.exit(1);
}

const phone = normalizeIsraeliPhone(values.from!) ?? `+${values.from!.replace(/\D/g, '')}`;
const waId = phone.replace(/^\+/, '');
const value = values.status
  ? { statuses: [{ id: values.id, status: values.status, recipient_id: waId }] }
  : {
      contacts: [{ wa_id: waId, profile: { name: values.name } }],
      messages: [
        {
          from: waId,
          id: `wamid.sim-${Date.now()}`,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'text',
          text: { body: values.text },
        },
      ],
    };
const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'simulator',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: config.WHATSAPP_PHONE_NUMBER_ID ?? 'simulator' },
            ...value,
          },
        },
      ],
    },
  ],
});

const url = values.url ?? `http://localhost:${config.PORT}${whatsappApiPaths.webhook}`;
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-hub-signature-256': signWebhookBody(body, config.WHATSAPP_APP_SECRET),
  },
  body,
});
console.log(`${res.status} ${await res.text()}`);
