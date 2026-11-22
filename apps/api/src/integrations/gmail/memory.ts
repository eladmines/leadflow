import { randomUUID } from 'node:crypto';
import type { GmailApi, GmailMessage, GmailOutgoing, GmailTokens } from './types';

/** Stands in for Google (local development and tests). */
export class MemoryGmailApi implements GmailApi {
  readonly available = true;
  /** What the next sign-in returns; codes other than `good-code` fail. */
  signIn: GmailTokens = { refreshToken: 'refresh-token', email: 'owner@gmail.com' };
  /** The inbox, newest last; only messages after the cursor are listed. */
  readonly inbox: GmailMessage[] = [];
  readonly sent: (GmailOutgoing & { id: string })[] = [];
  readonly revoked: string[] = [];
  /** When true the refresh token is rejected (to test a revoked grant). */
  rejectToken = false;

  authUrl(redirectUri: string, state: string): string {
    return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ redirect_uri: redirectUri, state })}`;
  }

  exchangeCode(code: string): Promise<GmailTokens> {
    return code === 'good-code'
      ? Promise.resolve(this.signIn)
      : Promise.reject(new Error('bad code'));
  }

  accessToken(): Promise<string> {
    return this.rejectToken
      ? Promise.reject(new Error('invalid_grant'))
      : Promise.resolve('access-token');
  }

  listInbox(_token: string, afterMs: number): Promise<GmailMessage[]> {
    return Promise.resolve(
      this.inbox.filter((m) => m.receivedAt > afterMs).sort((a, b) => a.receivedAt - b.receivedAt),
    );
  }

  send(_token: string, mail: GmailOutgoing): Promise<{ id: string }> {
    const id = `gm-${randomUUID()}`;
    this.sent.push({ ...mail, id });
    return Promise.resolve({ id });
  }

  revoke(refreshToken: string): Promise<void> {
    this.revoked.push(refreshToken);
    return Promise.resolve();
  }

  clear() {
    this.inbox.length = 0;
    this.sent.length = 0;
    this.revoked.length = 0;
    this.rejectToken = false;
    this.signIn = { refreshToken: 'refresh-token', email: 'owner@gmail.com' };
  }
}
