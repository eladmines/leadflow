import type { MetaApi, MetaPage } from './types';

/** Stands in for Meta (local development and tests). */
export class MemoryMetaApi implements MetaApi {
  /** Pages returned after sign-in; codes other than `good-code` fail. */
  pagesToReturn: MetaPage[] = [{ id: '100200300', name: 'דף לבדיקה', accessToken: 'page-token' }];
  readonly subscribed = new Set<string>();
  /** Phone number ids this "Meta" knows, with their display numbers. */
  readonly numbers = new Map<string, string>([['555000111', '+1 555-000-1111']]);

  exchangeCode(code: string): Promise<string> {
    return code === 'good-code'
      ? Promise.resolve('user-token')
      : Promise.reject(new Error('bad code'));
  }

  pages(): Promise<MetaPage[]> {
    return Promise.resolve(this.pagesToReturn);
  }

  subscribePage(pageId: string): Promise<void> {
    this.subscribed.add(pageId);
    return Promise.resolve();
  }

  unsubscribePage(pageId: string): Promise<void> {
    this.subscribed.delete(pageId);
    return Promise.resolve();
  }

  whatsappNumber(phoneNumberId: string): Promise<string | null> {
    return Promise.resolve(this.numbers.get(phoneNumberId) ?? null);
  }
}
