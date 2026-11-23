import { connect } from 'node:net';
import type { DomainLookup } from './types';

/** ISOC-IL's WHOIS for the `.il` ending (there is no RDAP for it). */
const HOST = 'whois.isoc.org.il';

/** `validity:     17-01-2027` → that date (UTC); null when the answer has none. */
export function expiryFromIsocWhois(text: string): Date | null {
  const m = /^\s*validity:\s*(\d{2})-(\d{2})-(\d{4})\s*$/im.exec(text);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  return Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(dd) ? null : d;
}

/** One question per domain, over TCP port 43, with a time limit. Used at most once a day per domain. */
export class IsocWhoisLookup {
  constructor(
    private readonly host = HOST,
    private readonly port = 43,
    private readonly timeoutMs = 10_000,
  ) {}

  lookup(domain: string): Promise<DomainLookup> {
    return new Promise((resolve) => {
      let data = '';
      let done = false;
      const finish = (r: DomainLookup) => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve(r);
      };
      const socket = connect({ host: this.host, port: this.port });
      socket.setTimeout(this.timeoutMs);
      socket.on('connect', () => socket.write(`${domain}\r\n`));
      socket.on('data', (chunk) => {
        data += chunk.toString('utf8');
        if (data.length > 64_000) finish({ status: 'failed' });
      });
      socket.on('end', () => {
        const expiresAt = expiryFromIsocWhois(data);
        finish(expiresAt ? { status: 'ok', expiresAt } : { status: 'failed' });
      });
      socket.on('timeout', () => finish({ status: 'failed' }));
      socket.on('error', () => finish({ status: 'failed' }));
    });
  }
}
