/**
 * F33: when a domain expires, read from its registry. Behind an interface like the other
 * integrations, so tests and an "off" mode never touch the network.
 */
export type DomainLookup =
  | { status: 'ok'; expiresAt: Date }
  /** This ending has no public lookup we can use. */
  | { status: 'unsupported' }
  /** The registry didn't answer or the answer wasn't understood: try again later. */
  | { status: 'failed' };

export interface DomainExpiry {
  /** `domain` is a registrable domain (`shiran.co.il`). Never throws. */
  lookup(domain: string): Promise<DomainLookup>;
}
