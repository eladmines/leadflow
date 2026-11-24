import { tr } from '../i18n';

/**
 * Stored messages mark media and unsupported types in Hebrew ("[תמונה] caption", "[מייל ללא טקסט]").
 * Shows that leading tag in the app language; the customer's own words are left as they wrote them.
 */
export function messageBody(body: string): string {
  return body.replace(/^\[([^\]\n]+)\]/, (_, tag: string) => `[${tr(tag)}]`);
}
