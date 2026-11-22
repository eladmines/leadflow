import type { AppConfig } from '../../config/env';
import { CloudGmailApi } from './cloud';
import { MemoryGmailApi } from './memory';
import type { GmailApi } from './types';

export type { GmailApi, GmailMessage, GmailOutgoing, GmailTokens } from './types';
export { CloudGmailApi, GmailApiError, parseFrom, toMessage } from './cloud';
export { MemoryGmailApi } from './memory';

/** Google when the OAuth client is configured; otherwise a stand-in whose sign-in is off. */
export function createGmailApi(config: AppConfig): GmailApi {
  if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
    return new CloudGmailApi({
      clientId: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
    });
  }
  return new MemoryGmailApi();
}
