import type { PrismaClient } from '@prisma/client';
import {
  DOMAIN_CHECKS,
  DOMAIN_REMINDER_DAYS,
  registrableDomain,
  type DomainExpiryResponse,
} from '@simplecatch/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../../config/env';
import type { DomainExpiry } from '../../integrations/domain';
import { domainExpiryTemplate, type EmailSender } from '../../integrations/email';
import { notifySafe } from '../notifications/service';
import type { TenantContext } from '../../plugins/tenant';

const DAY = 86_400_000;
/** A domain is looked up at most once a day (the registries ask for no high-volume automated use). */
const RECHECK_AFTER_MS = 20 * 3_600_000;
/** "Check now" can't be pressed more often than this. */
const MANUAL_COOLDOWN_MS = 60_000;

type Log = Pick<FastifyBaseLogger, 'error' | 'info'>;

/** Whole days from `now` to `to`, rounded up: a domain expiring in 6.2 days has 7 left. */
export const daysUntil = (to: Date, now: Date) => Math.ceil((to.getTime() - now.getTime()) / DAY);

/**
 * The tightest reminder already due: 60, 30 or 7 days before, or 0 (the day it expires and after);
 * null while it is more than 60 days away.
 */
export function reminderDue(daysLeft: number): number | null {
  const crossed = DOMAIN_REMINDER_DAYS.filter((d) => daysLeft <= d);
  return crossed.length ? Math.min(...crossed) : null;
}

export class DomainExpiryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: DomainExpiry,
    private readonly email: EmailSender,
    private readonly config: AppConfig,
    private readonly log: Log,
  ) {}

  /** What we know about the business's domain (no lookup). */
  async status(ctx: TenantContext, now = new Date()): Promise<DomainExpiryResponse> {
    const b = await this.prisma.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
      select: {
        websiteUrl: true,
        domainExpiresAt: true,
        domainCheckedAt: true,
        domainCheck: true,
      },
    });
    return this.toDto(b, now);
  }

  /** Looks it up now (unless it was just looked up), and answers with what we know. */
  async checkNow(ctx: TenantContext, now = new Date()): Promise<DomainExpiryResponse> {
    const b = await this.prisma.business.findUniqueOrThrow({
      where: { id: ctx.businessId },
      select: { domainCheckedAt: true },
    });
    if (!b.domainCheckedAt || now.getTime() - b.domainCheckedAt.getTime() > MANUAL_COOLDOWN_MS) {
      await this.check(ctx.businessId, now);
    }
    return this.status(ctx, now);
  }

  /** The daily job: every business whose domain wasn't looked up lately. Returns how many were. */
  async checkDue(now = new Date(), limit = 20): Promise<number> {
    const due = await this.prisma.business.findMany({
      where: {
        websiteUrl: { not: null },
        OR: [
          { domainCheckedAt: null },
          { domainCheckedAt: { lt: new Date(now.getTime() - RECHECK_AFTER_MS) } },
        ],
      },
      select: { id: true },
      orderBy: { domainCheckedAt: { sort: 'asc', nulls: 'first' } },
      take: limit,
    });
    for (const b of due) await this.check(b.id, now);
    return due.length;
  }

  /** One lookup, saved; then the reminders that are due (each goes out once per expiry date). */
  async check(businessId: string, now = new Date()): Promise<void> {
    const b = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: {
        name: true,
        language: true,
        websiteUrl: true,
        domainExpiresAt: true,
        domainRemindedDays: true,
      },
    });
    if (!b) return;
    const domain = registrableDomain(b.websiteUrl);
    if (!domain) {
      await this.prisma.business.update({
        where: { id: businessId },
        data: { domainCheck: null, domainCheckedAt: null, domainExpiresAt: null },
      });
      return;
    }
    const found = await this.provider.lookup(domain);
    if (found.status !== 'ok') {
      // Keep an earlier date if the registry just didn't answer this time.
      await this.prisma.business.update({
        where: { id: businessId },
        data: {
          domainCheck: found.status === 'failed' && b.domainExpiresAt ? 'ok' : found.status,
          domainCheckedAt: now,
        },
      });
      return;
    }
    // A later expiry than before means it was renewed: the reminders start over.
    const renewed =
      b.domainExpiresAt && found.expiresAt.getTime() - b.domainExpiresAt.getTime() > 30 * DAY;
    const reminded = renewed ? null : b.domainRemindedDays;
    const daysLeft = daysUntil(found.expiresAt, now);
    const due = reminderDue(daysLeft);
    const send = due !== null && (reminded === null || due < reminded);
    await this.prisma.business.update({
      where: { id: businessId },
      data: {
        domainCheck: 'ok',
        domainCheckedAt: now,
        domainExpiresAt: found.expiresAt,
        domainRemindedDays: send ? due : renewed ? null : b.domainRemindedDays,
      },
    });
    if (send) await this.remind(businessId, b, domain, found.expiresAt, daysLeft);
  }

  /** The bell and an email for the owner and managers. */
  private async remind(
    businessId: string,
    b: { language: string },
    domain: string,
    expiresAt: Date,
    daysLeft: number,
  ) {
    await notifySafe(this.prisma, this.log, {
      businessId,
      type: 'domain.expiring',
      data: { domain, days: daysLeft, expiresAt: expiresAt.toISOString() },
      to: { roles: ['OWNER', 'MANAGER'] },
    });
    const lang = b.language === 'en' ? 'en' : 'he';
    const expiresText = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'he-IL', {
      dateStyle: 'long',
      timeZone: 'UTC',
    }).format(expiresAt);
    const members = await this.prisma.membership.findMany({
      where: { businessId, status: 'ACTIVE', role: { in: ['OWNER', 'MANAGER'] } },
      select: { user: { select: { email: true, status: true } } },
    });
    for (const { user } of members) {
      if (user.status !== 'ACTIVE') continue;
      try {
        await this.email.send({
          to: user.email,
          ...domainExpiryTemplate(
            { domain, expiresText, daysLeft, link: `${this.config.APP_URL}/b/${businessId}/site` },
            lang,
          ),
        });
      } catch (err) {
        this.log.error(
          { errName: (err as Error)?.name, template: 'domainExpiry' },
          'domain expiry email failed',
        );
      }
    }
  }

  private toDto(
    b: {
      websiteUrl: string | null;
      domainExpiresAt: Date | null;
      domainCheckedAt: Date | null;
      domainCheck: string | null;
    },
    now: Date,
  ): DomainExpiryResponse {
    const check = (DOMAIN_CHECKS as readonly string[]).includes(b.domainCheck ?? '')
      ? (b.domainCheck as DomainExpiryResponse['check'])
      : null;
    return {
      domain: registrableDomain(b.websiteUrl),
      check,
      expiresAt: b.domainExpiresAt?.toISOString() ?? null,
      checkedAt: b.domainCheckedAt?.toISOString() ?? null,
      daysLeft: b.domainExpiresAt ? daysUntil(b.domainExpiresAt, now) : null,
    };
  }
}
