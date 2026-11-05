import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailMessage, EmailSender } from './types';

export interface SmtpOptions {
  host: string;
  port: number;
  from: string;
  /** TLS from the first byte (port 465); otherwise STARTTLS when the server offers it. */
  secure?: boolean;
  auth?: { user: string; pass: string };
}

/**
 * SMTP: Mailpit locally (no auth), or a real mail server with a login — Gmail with an app
 * password while there is no sending domain (D-119).
 */
export class SmtpEmailSender implements EmailSender {
  private readonly transporter: Transporter;

  constructor(private readonly opts: SmtpOptions) {
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure ?? false,
      auth: opts.auth,
      // Never let nodemailer log message contents (they include tokens).
      logger: false,
      debug: false,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.opts.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }

  close(): void {
    this.transporter.close();
  }
}
