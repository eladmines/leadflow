import type { AppConfig } from '../../config/env';
import { MemoryEmailSender } from './memory';
import { SmtpEmailSender } from './smtp';
import type { EmailSender } from './types';

export type { EmailMessage, EmailSender } from './types';
export { MemoryEmailSender } from './memory';
export { SmtpEmailSender } from './smtp';
export {
  inviteTemplate,
  newLeadTemplate,
  passwordChangedTemplate,
  passwordResetTemplate,
  taskReminderTemplate,
  verifyEmailTemplate,
} from './templates';

/** Picks the adapter from `EMAIL_TRANSPORT`. */
export function createEmailSender(config: AppConfig): EmailSender {
  if (config.EMAIL_TRANSPORT === 'memory') return new MemoryEmailSender();
  return new SmtpEmailSender({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    from: config.EMAIL_FROM,
  });
}
