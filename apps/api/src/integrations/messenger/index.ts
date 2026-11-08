import type { AppConfig } from '../../config/env';
import { CloudMessengerSender } from './cloud';
import { MemoryMessengerSender } from './memory';
import type { MessengerSender } from './types';

export type { MessengerSender } from './types';
export { MemoryMessengerSender } from './memory';
export { CloudMessengerSender, MessengerSendError } from './cloud';

/** Picks the adapter from `MESSENGER_PROVIDER` (F23). */
export function createMessengerSender(config: AppConfig): MessengerSender {
  if (config.MESSENGER_PROVIDER === 'cloud') {
    return new CloudMessengerSender({
      pageId: config.MESSENGER_PAGE_ID!,
      pageAccessToken: config.MESSENGER_PAGE_ACCESS_TOKEN!,
      graphVersion: config.WHATSAPP_GRAPH_VERSION,
    });
  }
  return new MemoryMessengerSender();
}
