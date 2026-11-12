import { Global, Module } from '@nestjs/common';
import { EmailDeliveryFailures } from './application/email-delivery-failures';
import { EMAIL_SENDER } from './application/email-sender.port';
import { EmailQueuesModule } from './email-queues.module';
import {
  DefaultEmailProcessor,
  LoginEmailProcessor,
} from './infrastructure/email-delivery.processors';
import { SmtpEmailSender } from './infrastructure/smtp-email-sender';

/**
 * Consome as filas de e-mail e envia pelo SMTP, do lado do worker. Global para
 * os módulos do worker se registrarem nas desistências (EmailDeliveryFailures).
 */
@Global()
@Module({
  imports: [EmailQueuesModule],
  providers: [
    { provide: EMAIL_SENDER, useClass: SmtpEmailSender },
    LoginEmailProcessor,
    DefaultEmailProcessor,
    EmailDeliveryFailures,
  ],
  // O EMAIL_SENDER também serve ao e-mail das respostas, que avança o cursor só
  // depois do envio aceito (E-mail e push RN02).
  exports: [EmailDeliveryFailures, EMAIL_SENDER],
})
export class EmailWorkerModule {}
