import { Module } from '@nestjs/common';
import { EMAIL_SENDER } from './application/email-sender.port';
import { EmailQueuesModule } from './email-queues.module';
import {
  DefaultEmailProcessor,
  LoginEmailProcessor,
} from './infrastructure/email-delivery.processors';
import { SmtpEmailSender } from './infrastructure/smtp-email-sender';

/** Consome as filas de e-mail e envia pelo SMTP, do lado do worker. */
@Module({
  imports: [EmailQueuesModule],
  providers: [
    { provide: EMAIL_SENDER, useClass: SmtpEmailSender },
    LoginEmailProcessor,
    DefaultEmailProcessor,
  ],
})
export class EmailWorkerModule {}
