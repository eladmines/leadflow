import type { DomainExpiry, DomainLookup } from './types';

/** For tests and the "off" mode: answers from a table, never from the network. */
export class MemoryDomainExpiry implements DomainExpiry {
  readonly asked: string[] = [];
  constructor(private readonly answers: Record<string, DomainLookup> = {}) {}
  set(domain: string, answer: DomainLookup) {
    this.answers[domain] = answer;
  }
  async lookup(domain: string): Promise<DomainLookup> {
    this.asked.push(domain);
    return this.answers[domain] ?? { status: 'unsupported' };
  }
}
