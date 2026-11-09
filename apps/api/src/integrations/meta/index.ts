import type { AppConfig } from '../../config/env';
import { CloudMetaApi } from './cloud';
import { MemoryMetaApi } from './memory';
import type { MetaApi } from './types';

export type { MetaApi, MetaPage } from './types';
export { CloudMetaApi, MetaApiError } from './cloud';
export { MemoryMetaApi } from './memory';

/** Real Meta when a channel uses the cloud provider and the app is known; else the stand-in. */
export function createMetaApi(config: AppConfig): MetaApi {
  const cloud = config.WHATSAPP_PROVIDER === 'cloud' || config.MESSENGER_PROVIDER === 'cloud';
  if (cloud && config.WHATSAPP_APP_SECRET) {
    return new CloudMetaApi({
      appId: config.META_APP_ID ?? '',
      appSecret: config.WHATSAPP_APP_SECRET,
      graphVersion: config.WHATSAPP_GRAPH_VERSION,
    });
  }
  return new MemoryMetaApi();
}
