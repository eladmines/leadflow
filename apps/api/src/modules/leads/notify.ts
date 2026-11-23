import type { PrismaClient } from '@prisma/client';
import { formatIsraeliPhone, type LeadSubmission } from '@simplecatch/shared';
import type { AppConfig } from '../../config/env';
import { newLeadTemplate, type EmailSender } from '../../integrations/email';

/**
 * Emails owners and managers about a new website lead (best effort: a failed email never loses the
 * lead). Shared by the SimpleCatch sites (F07) and forms on other websites (F30).
 */
export async function notifyTeamByEmail(
  deps: { prisma: PrismaClient; email: EmailSender; config: AppConfig },
  businessId: string,
  businessName: string,
  d: Pick<LeadSubmission, 'name' | 'phone' | 'email' | 'message'>,
  log: { error: (obj: object, msg: string) => void },
  requested: string | null = null,
) {
  const { prisma, email, config } = deps;
  const team = await prisma.membership.findMany({
    where: {
      businessId,
      status: 'ACTIVE',
      role: { in: ['OWNER', 'MANAGER'] },
      notifyNewLeads: true,
    },
    select: { user: { select: { email: true, status: true } } },
  });
  const { language } = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { language: true },
  });
  const en = language === 'en';
  const mail = newLeadTemplate(
    {
      businessName,
      name: d.name,
      phone: formatIsraeliPhone(d.phone),
      email: d.email,
      message: requested
        ? `${en ? 'Appointment request' : 'בקשה לתור'}: ${requested}${d.message ? `\n\n${d.message}` : ''}`
        : d.message,
      link: `${config.APP_URL}/b/${businessId}/leads`,
      settingsLink: `${config.APP_URL}/b/${businessId}/account`,
    },
    en ? 'en' : 'he',
  );
  for (const { user } of team) {
    if (user.status !== 'ACTIVE') continue;
    try {
      await email.send({ to: user.email, ...mail });
    } catch (err) {
      log.error({ errName: (err as Error)?.name, template: 'newLead' }, 'lead email failed');
    }
  }
}
