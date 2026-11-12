import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { EMAIL_OUTBOX } from './application/email-outbox.port';
import { EMAIL_SENDER } from './application/email-sender.port';
import { BullmqEmailOutbox } from './infrastructure/bullmq-email-outbox';
import { DEFAULT_EMAIL_QUEUE, LOGIN_EMAIL_QUEUE } from './infrastructure/email-queues';
import { SmtpEmailSender } from './infrastructure/smtp-email-sender';

/**
 * Conexão produtora da API sem fila offline: com o Redis fora, o add falha na
 * hora e o outbox envia direto. Com a fila offline, o add guardado sairia
 * quando o Redis voltasse, com o código de login já vencido.
 */
const producerQueue = (name: string) =>
  BullModule.registerQueueAsync({
    name,
    inject: [AppConfigService],
    useFactory: (config: AppConfigService) => ({
      connection: { url: config.get({ key: 'REDIS_URL' }), enableOfflineQueue: false },
    }),
  });

/**
 * E-mail aos usuários. Os módulos usam EMAIL_OUTBOX (fila); o EMAIL_SENDER
 * (SMTP) é o envio em si, usado pelo worker e pelo envio direto de reserva.
 */
@Global()
@Module({
  imports: [producerQueue(LOGIN_EMAIL_QUEUE), producerQueue(DEFAULT_EMAIL_QUEUE)],
  providers: [
    { provide: EMAIL_SENDER, useClass: SmtpEmailSender },
    { provide: EMAIL_OUTBOX, useClass: BullmqEmailOutbox },
  ],
  exports: [EMAIL_SENDER, EMAIL_OUTBOX],
})
export class EmailModule {}
