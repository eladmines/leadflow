/**
 * Local stand-in for the inbound-email service (F27): posts a signed email to the local API, as if
 * a customer wrote to the business's forwarding address. Needs EMAIL_INBOUND_DOMAIN and
 * EMAIL_INBOUND_SECRET in .env, and the address created in Settings → Channels.
 *
 *   pnpm --filter @leadflow/api mail:simulate --to abc123xyz9@mail.leadflow.local \
 *     --from dana@example.com --name "דנה" --subject "תור" --text "היי, אפשר תור?"
 */
import { parseArgs } from 'node:util';
import { EMAIL_SIGNATURE_HEADER, emailInboundPath } from '@leadflow/shared';
import { loadConfig } from '../src/config/env';
import { signWebhookBody } from '../src/integrations/whatsapp';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    to: { type: 'string' },
    from: { type: 'string', default: 'dana@example.com' },
    name: { type: 'string', default: 'דנה כהן' },
    subject: { type: 'string', default: 'שאלה על תור' },
    text: { type: 'string', default: 'היי, אפשר לקבוע תור ליום חמישי?' },
    url: { type: 'string' },
  },
});

const config = loadConfig();
if (!config.EMAIL_INBOUND_SECRET || !config.EMAIL_INBOUND_DOMAIN) {
  console.error('Set EMAIL_INBOUND_DOMAIN and EMAIL_INBOUND_SECRET in apps/api/.env first.');
  process.exit(1);
}
if (!values.to) {
  console.error('Pass --to <the business forwarding address> (shown in Settings → Channels).');
  process.exit(1);
}

const body = JSON.stringify({
  to: values.to,
  from: values.from,
  fromName: values.name,
  subject: values.subject,
  text: values.text,
  messageId: `<sim-${Date.now()}@simulator.local>`,
});
const base = values.url ?? `http://localhost:${config.PORT}`;
const res = await fetch(`${base}${emailInboundPath}`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    [EMAIL_SIGNATURE_HEADER]: signWebhookBody(body, config.EMAIL_INBOUND_SECRET),
  },
  body,
});
console.log(res.ok ? 'Sent.' : `Failed: ${res.status}`);
