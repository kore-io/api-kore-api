import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DEFAULT_EMAIL_QUEUE, LOGIN_EMAIL_QUEUE } from './infrastructure/email-queues';

/** As duas filas de e-mail, do lado do worker (consumidor). */
@Module({
  imports: [BullModule.registerQueue({ name: LOGIN_EMAIL_QUEUE }, { name: DEFAULT_EMAIL_QUEUE })],
  exports: [BullModule],
})
export class EmailQueuesModule {}
