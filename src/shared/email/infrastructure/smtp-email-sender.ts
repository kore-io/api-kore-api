import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { AppConfigService } from '../../config/app-config.service';
import { EmailMessage, EmailSender } from '../application/email-sender.port';

/** Adaptador SMTP: Mailpit no ambiente local; o SES entra com a infraestrutura. */
@Injectable()
export class SmtpEmailSender implements EmailSender, OnModuleDestroy {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: AppConfigService) {
    this.from = config.get({ key: 'EMAIL_FROM' });
    this.transporter = createTransport({
      host: config.get({ key: 'SMTP_HOST' }),
      port: config.get({ key: 'SMTP_PORT' }),
      secure: false,
    });
  }

  async send({ message }: { message: EmailMessage }): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...message });
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }
}
