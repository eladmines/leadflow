import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { expiryFromRdap, IsocWhoisLookup, RdapLookup, expiryFromIsocWhois } from './index';

const ISOC_ANSWER = `% The data in the WHOIS database of the .il registry is provided
% by ISOC-IL for information purposes
query:        walla.co.il

reg-name:     walla
domain:       walla.co.il

registrant:   Walla Communications Ltd.
assigned:     17-01-2019
validity:     17-01-2027
DNSSEC:       unsigned
status:       Transfer Locked
`;

describe('reading the expiry from a registry (F33)', () => {
  it('RDAP: the expiration event', () => {
    expect(
      expiryFromRdap({
        events: [
          { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
          { eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' },
        ],
      })?.toISOString(),
    ).toBe('2027-08-13T04:00:00.000Z');
    expect(expiryFromRdap({ events: [] })).toBeNull();
    expect(
      expiryFromRdap({ events: [{ eventAction: 'expiration', eventDate: 'soon' }] }),
    ).toBeNull();
    expect(expiryFromRdap(null)).toBeNull();
    expect(expiryFromRdap('nope')).toBeNull();
  });

  it('ISOC-IL WHOIS: the validity line', () => {
    expect(expiryFromIsocWhois(ISOC_ANSWER)?.toISOString()).toBe('2027-01-17T00:00:00.000Z');
    expect(expiryFromIsocWhois('no such domain')).toBeNull();
    expect(expiryFromIsocWhois('validity:     31-02-2027')).toBeNull();
  });
});

describe('RdapLookup', () => {
  const bootstrap = {
    services: [
      [['com', 'net'], ['https://rdap.example-registry.test/com/v1/']],
      [['dev'], ['http://insecure.test/', 'https://rdap.dev.test/']],
    ],
  };
  const answer = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  function fakeFetch(domainAnswer: () => Response | Error) {
    const urls: string[] = [];
    const doFetch = (async (url: string) => {
      urls.push(url);
      if (url.includes('dns.json')) return answer(bootstrap);
      const r = domainAnswer();
      if (r instanceof Error) throw r;
      return r;
    }) as unknown as typeof fetch;
    return { doFetch, urls };
  }

  it('asks the registry the bootstrap names, and reads the date', async () => {
    const { doFetch, urls } = fakeFetch(() =>
      answer({ events: [{ eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' }] }),
    );
    const rdap = new RdapLookup(doFetch);
    expect(await rdap.lookup('example.com')).toEqual({
      status: 'ok',
      expiresAt: new Date('2027-08-13T04:00:00Z'),
    });
    expect(urls.at(-1)).toBe('https://rdap.example-registry.test/com/v1/domain/example.com');
    // Prefers https, and the bootstrap is fetched once.
    await rdap.lookup('x.dev');
    expect(urls.at(-1)).toBe('https://rdap.dev.test/domain/x.dev');
    expect(urls.filter((u) => u.includes('dns.json'))).toHaveLength(1);
  });

  it('says unsupported for an ending RDAP does not serve, failed for any trouble', async () => {
    const { doFetch } = fakeFetch(() => answer({}, 404));
    const rdap = new RdapLookup(doFetch);
    expect(await rdap.lookup('shiran.xyz')).toEqual({ status: 'unsupported' });
    expect(await rdap.lookup('missing.com')).toEqual({ status: 'failed' });
    const down = new RdapLookup(fakeFetch(() => new Error('network down')).doFetch);
    expect(await down.lookup('example.com')).toEqual({ status: 'failed' });
    const odd = new RdapLookup(fakeFetch(() => answer({ events: [] })).doFetch);
    expect(await odd.lookup('example.com')).toEqual({ status: 'failed' });
  });
});

describe('IsocWhoisLookup (a real socket, to a local stand-in server)', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  const serve = (onQuery: (query: string, end: () => void, write: (s: string) => void) => void) =>
    new Promise<number>((resolve) => {
      server = createServer((socket) => {
        socket.once('data', (d) =>
          onQuery(
            d.toString().trim(),
            () => socket.end(),
            (s) => socket.write(s),
          ),
        );
      }).listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port));
    });

  it('sends the domain and reads the validity date', async () => {
    let asked = '';
    const port = await serve((q, end, write) => {
      asked = q;
      write(ISOC_ANSWER);
      end();
    });
    const whois = new IsocWhoisLookup('127.0.0.1', port, 2_000);
    expect(await whois.lookup('walla.co.il')).toEqual({
      status: 'ok',
      expiresAt: new Date('2027-01-17T00:00:00Z'),
    });
    expect(asked).toBe('walla.co.il');
  });

  it('is failed when the answer has no date, the server stalls, or nothing listens', async () => {
    let port = await serve((_q, end, write) => {
      write('% No entries found\n');
      end();
    });
    expect(await new IsocWhoisLookup('127.0.0.1', port, 2_000).lookup('nope.co.il')).toEqual({
      status: 'failed',
    });
    server?.close();
    port = await serve(() => {
      /* never answers */
    });
    expect(await new IsocWhoisLookup('127.0.0.1', port, 300).lookup('slow.co.il')).toEqual({
      status: 'failed',
    });
    server?.close();
    expect(await new IsocWhoisLookup('127.0.0.1', 1, 300).lookup('closed.co.il')).toEqual({
      status: 'failed',
    });
  });
});
