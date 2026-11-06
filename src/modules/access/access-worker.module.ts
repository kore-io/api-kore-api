import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LogsWorkerModule } from '../logs/logs-worker.module';
import { ACCESS_CLEANUP } from './application/ports/access-cleanup.port';
import { PurgeEndedAccess } from './application/purge-ended-access.use-case';
import {
  ACCESS_CLEANUP_QUEUE,
  AccessCleanupProcessor,
  AccessCleanupScheduler,
} from './infrastructure/access-cleanup.job';
import { PrismaAccessCleanup } from './infrastructure/backoffice/prisma-access-cleanup';
import { EMAIL_OUTBOX } from '../../shared/email/application/email-outbox.port';
import { EMAIL_SENDER } from '../../shared/email/application/email-sender.port';
import { EmailQueuesModule } from '../../shared/email/email-queues.module';
import { BullmqEmailOutbox } from '../../shared/email/infrastructure/bullmq-email-outbox';
import { SmtpEmailSender } from '../../shared/email/infrastructure/smtp-email-sender';
import { OWNERLESS_WEDDINGS } from './application/ports/ownerless-weddings.port';
import { PURGE_NOTICE_MAILER } from './application/ports/purge-notice-mailer.port';
import { PurgeOwnerlessWeddings } from './application/purge-ownerless-weddings.use-case';
import { PrismaOwnerlessWeddings } from './infrastructure/backoffice/prisma-ownerless-weddings';
import {
  OWNERLESS_PURGE_QUEUE,
  OwnerlessPurgeProcessor,
  OwnerlessPurgeScheduler,
} from './infrastructure/ownerless-purge.job';
import { OutboxPurgeNoticeMailer } from './infrastructure/outbox-purge-notice-mailer';

/** Rotinas do contexto Acesso, do lado do worker. */
@Module({
  imports: [
    BullModule.registerQueue({ name: ACCESS_CLEANUP_QUEUE }, { name: OWNERLESS_PURGE_QUEUE }),
    // O aviso de exclusão (e-mail 6) entra na fila de e-mail, como na API.
    EmailQueuesModule,
    // O log da aplicação pela conexão do backoffice (registro da execução).
    LogsWorkerModule,
  ],
  providers: [
    { provide: ACCESS_CLEANUP, useClass: PrismaAccessCleanup },
    PurgeEndedAccess,
    AccessCleanupProcessor,
    AccessCleanupScheduler,
    { provide: OWNERLESS_WEDDINGS, useClass: PrismaOwnerlessWeddings },
    { provide: EMAIL_SENDER, useClass: SmtpEmailSender },
    { provide: EMAIL_OUTBOX, useClass: BullmqEmailOutbox },
    { provide: PURGE_NOTICE_MAILER, useClass: OutboxPurgeNoticeMailer },
    PurgeOwnerlessWeddings,
    OwnerlessPurgeProcessor,
    OwnerlessPurgeScheduler,
  ],
})
export class AccessWorkerModule {}
