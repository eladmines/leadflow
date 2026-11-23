import type { AppConfig } from '../../config/env';
import { MemoryDomainExpiry } from './memory';
import { RdapLookup } from './rdap';
import type { DomainExpiry, DomainLookup } from './types';
import { IsocWhoisLookup } from './whois-il';

export type { DomainExpiry, DomainLookup } from './types';
export { MemoryDomainExpiry } from './memory';
export { expiryFromRdap, RdapLookup } from './rdap';
export { expiryFromIsocWhois, IsocWhoisLookup } from './whois-il';

/** `.il` goes to ISOC-IL's WHOIS; everything RDAP knows goes to RDAP; the rest isn't supported. */
export class RegistryDomainExpiry implements DomainExpiry {
  constructor(
    private readonly rdap = new RdapLookup(),
    private readonly isoc = new IsocWhoisLookup(),
  ) {}

  async lookup(domain: string): Promise<DomainLookup> {
    if (domain.endsWith('.il')) return this.isoc.lookup(domain);
    return this.rdap.lookup(domain);
  }
}

/** The registries (`DOMAIN_LOOKUP=live`), or nothing at all (`off`: every ending reads as unsupported). */
export function createDomainExpiry(config: AppConfig): DomainExpiry {
  return config.DOMAIN_LOOKUP === 'live' ? new RegistryDomainExpiry() : new MemoryDomainExpiry();
}
