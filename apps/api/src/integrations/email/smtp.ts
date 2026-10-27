import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailMessage, EmailSender } from './types';

export interface SmtpOptions {
  host: string;
  port: number;
  from: string;
}

/**
 * Plain SMTP (Mailpit locally). Auth/TLS for a production provider is out of scope until
 * the email provider is chosen (O-009).
 */
export class SmtpEmailSender implements EmailSender {
  private readonly transporter: Transporter;

  constructor(private readonly opts: SmtpOptions) {
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: false,
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
