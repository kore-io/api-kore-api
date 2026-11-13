import { producerQueue } from '../jobs/producer-queue';
import { Global, Module } from '@nestjs/common';
import { EMAIL_OUTBOX } from './application/email-outbox.port';
import { EMAIL_SENDER } from './application/email-sender.port';
import { BullmqEmailOutbox } from './infrastructure/bullmq-email-outbox';
import { DEFAULT_EMAIL_QUEUE, LOGIN_EMAIL_QUEUE } from './infrastructure/email-queues';
import { SmtpEmailSender } from './infrastructure/smtp-email-sender';

/**
 * E-mail aos usuários. Os módulos usam EMAIL_OUTBOX (fila); o EMAIL_SENDER
 * (SMTP) é o envio em si, usado pelo worker e pelo envio direto de reserva.
 * As filas são produtoras sem fila offline (shared/jobs/producer-queue): com o
 * Redis fora, o add falha na hora e o outbox envia direto; com a fila offline,
 * o add guardado sairia quando o Redis voltasse, com o código de login já vencido.
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
