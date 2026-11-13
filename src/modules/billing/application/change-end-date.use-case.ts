import { Inject, Injectable, Logger } from '@nestjs/common';
import { localDate } from '../../../shared/time/local-date';
import { WeddingScope } from '../../access/application/wedding-scope.service';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { WeddingNotFoundError } from '../../access/domain/access.errors';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import {
  BillingEndDateOutOfRangeError,
  BillingWeddingBlockedError,
  EndDateBeyondPaidError,
  NotPublishedError,
  WeddingDeletionScheduledError,
} from '../domain/billing.errors';
import { addDays, addMonths, CURRENT_PRICE_TABLE } from '../domain/pricing';
import { CancelPendingPayment } from './cancel-pending-payment';
import {
  PAYMENT_REQUEST_STORE,
  type PaymentRequestStore,
} from './ports/payment-request.store.port';

const logger = new Logger('ChangeEndDate');
const CHANGEABLE = new Set(['published', 'post_event', 'grace']);

export interface EndDateChanged {
  endDate: string;
  paidThrough: string | null;
  status: string;
}

/**
 * PATCH …/end-date (Data de saída do ar RN05; decisão 231, B4-1): antecipar
 * ou voltar a data de graça, só o dono (`manage_billing`). A data nova vai de
 * amanhã (e depois do casamento) até o limite de 12 meses e **até o
 * paidThrough** (o publicado por Cortesia, sem paidThrough, até a endDate
 * dele); depois disso, paga-se a extensão. Não cobra nem devolve. Na carência,
 * voltar a data a encerra. Depois do commit, cancela o Pix de extensão
 * pendente, cotado com a data anterior (G1; B2-9).
 */
@Injectable()
export class ChangeEndDate {
  constructor(
    private readonly scope: WeddingScope,
    private readonly authorization: WeddingAuthorization,
    @Inject(PAYMENT_REQUEST_STORE) private readonly payments: PaymentRequestStore,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
    private readonly cancelPending: CancelPendingPayment,
  ) {}

  async execute({
    userId,
    weddingId,
    endDate,
    ip,
    now,
  }: {
    userId: string;
    weddingId: string;
    endDate: string;
    ip: string | null;
    now: Date;
  }): Promise<EndDateChanged> {
    const { changed, pendingExtensionId } = await this.scope.run({
      userId,
      weddingId,
      work: async () => {
        await this.authorization.require({ userId, weddingId, action: 'manage_billing' });
        const wedding = await this.payments.lockWedding({ weddingId });
        if (!wedding) throw new WeddingNotFoundError();
        if (wedding.blockedAt) throw new BillingWeddingBlockedError();
        if (wedding.deletionScheduledFor) throw new WeddingDeletionScheduledError();
        if (!wedding.publishedAt || !CHANGEABLE.has(wedding.status) || !wedding.endDate)
          throw new NotPublishedError();

        const today = localDate({ at: now, timezone: wedding.timezone });
        const tomorrow = addDays({ day: today, days: 1 });
        const dayAfterWedding = wedding.eventDate
          ? addDays({ day: wedding.eventDate, days: 1 })
          : tomorrow;
        const min = tomorrow > dayAfterWedding ? tomorrow : dayAfterWedding;
        const max = wedding.eventDate
          ? addMonths({
              day: wedding.eventDate,
              months: CURRENT_PRICE_TABLE.endDateMaxMonthsAfterEvent,
            })
          : endDate;
        if (endDate < min || endDate > max) throw new BillingEndDateOutOfRangeError(min, max);
        const paidLimit = wedding.paidThrough ?? wedding.endDate;
        if (endDate > paidLimit) throw new EndDateBeyondPaidError(paidLimit);

        if (endDate === wedding.endDate)
          return {
            changed: { endDate, paidThrough: wedding.paidThrough, status: wedding.status },
            pendingExtensionId: null,
          };
        const status = await this.payments.setEndDate({ weddingId, endDate, today, now });
        if (!status) throw new NotPublishedError();
        await this.log.record({
          entry: {
            action:
              endDate < wedding.endDate
                ? 'wedding.end_date_brought_forward'
                : 'wedding.end_date_restored',
            actorKind: 'user',
            actorUserId: userId,
            weddingId,
            entityType: 'wedding',
            entityId: weddingId,
            data: { from: wedding.endDate, to: endDate, paidThrough: wedding.paidThrough },
            ...(ip ? { ip } : {}),
          },
        });
        return {
          changed: { endDate, paidThrough: wedding.paidThrough, status },
          pendingExtensionId: await this.payments.pendingExtensionId({ weddingId }),
        };
      },
    });

    if (pendingExtensionId) {
      try {
        await this.cancelPending.execute({
          paymentId: pendingExtensionId,
          reason: 'end_date_changed',
          now,
        });
      } catch (error) {
        // O Pix que vencer, a reconciliação cancela; o que for pago, vira sem destino (RN08).
        logger.warn(
          `Pix de extensão ${pendingExtensionId} não cancelado: ${(error as Error).name}`,
        );
      }
    }
    return changed;
  }
}
