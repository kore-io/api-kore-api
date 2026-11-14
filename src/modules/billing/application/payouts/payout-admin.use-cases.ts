import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../../shared/config/app-config.service';
import { BackofficeTransaction } from '../../../../shared/database/backoffice-transaction';
import {
  EMAIL_OUTBOX,
  type EmailOutbox,
} from '../../../../shared/email/application/email-outbox.port';
import {
  PayoutBelowMinimumError,
  PayoutNotFoundError,
  PayoutPixKeyChangePendingError,
  PayoutReferrerBlockedError,
  PayoutStatusConflictError,
  PayoutStillHeldError,
} from '../../domain/payout.errors';
import { PLANNER_COMMISSIONS_PATH } from '../../../notifications/application/rsvp-emails.use-cases';
import { payoutRejectedEmail } from '../../infrastructure/emails/payout.email';
import {
  PAYOUT_ADMIN_STORE,
  type PayoutAdminStore,
  type PayoutQueueRow,
  type PayoutQueueTab,
} from '../ports/payout-admin.store.port';
import { PAYOUT_LEDGER, type PayoutLedger } from '../ports/payout-ledger.port';

/**
 * A fila de Repasses do Admin (Backoffice - cobrança RN09): Solicitados (com
 * os em processamento), Retidos (com o motivo e o valor do Liberar) e Histórico.
 */
@Injectable()
export class ListPayoutQueue {
  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(PAYOUT_ADMIN_STORE) private readonly store: PayoutAdminStore,
  ) {}

  execute({
    tab,
    referrerId,
    page,
  }: {
    tab: PayoutQueueTab;
    referrerId?: string;
    page: number;
  }): Promise<{ items: PayoutQueueRow[]; total: number; pageSize: number }> {
    return this.transaction.run(() => this.store.queue({ tab, referrerId, page }));
  }
}

/**
 * Recusar (RN09), com motivo: as comissões e os ajustes voltam ao saldo, o
 * pedido não conta para os 30 dias, log `payout.rejected` na transação e, depois
 * do commit, o e-mail "Repasse recusado".
 */
@Injectable()
export class RejectPayout {
  private readonly appUrl: string;

  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(PAYOUT_ADMIN_STORE) private readonly store: PayoutAdminStore,
    @Inject(PAYOUT_LEDGER) private readonly ledger: PayoutLedger,
    @Inject(EMAIL_OUTBOX) private readonly outbox: EmailOutbox,
    config: AppConfigService,
  ) {
    this.appUrl = config.get({ key: 'APP_URL' }).replace(/\/+$/, '');
  }

  execute({
    payoutId,
    adminUserId,
    reason,
    now,
  }: {
    payoutId: string;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<void> {
    return this.transaction.run(async () => {
      const outcome = await this.store.reject({ payoutId, byUserId: adminUserId, reason, now });
      if (outcome.result === 'not_found') throw new PayoutNotFoundError();
      if (outcome.result === 'conflict')
        throw new PayoutStatusConflictError(outcome.status, 'requested');
      const recipient = await this.ledger.recipient({ userId: outcome.referrerUserId });
      this.transaction.schedule(() =>
        this.outbox.enqueue({
          message: payoutRejectedEmail({
            to: recipient.email,
            firstName: recipient.firstName,
            url: `${this.appUrl}${PLANNER_COMMISSIONS_PATH}`,
          }),
          priority: 'default',
        }),
      );
    });
  }
}

/** Liberar o retido (RN09): recalculado sem as estornadas e bloqueadas, a partir do mínimo. */
@Injectable()
export class ReleasePayout {
  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(PAYOUT_ADMIN_STORE) private readonly store: PayoutAdminStore,
  ) {}

  execute({
    payoutId,
    adminUserId,
    now,
  }: {
    payoutId: string;
    adminUserId: string;
    now: Date;
  }): Promise<{ amountCents: number }> {
    return this.transaction.run(async () => {
      const outcome = await this.store.release({ payoutId, byUserId: adminUserId, now });
      switch (outcome.result) {
        case 'released':
          return { amountCents: outcome.amountCents };
        case 'not_found':
          throw new PayoutNotFoundError();
        case 'conflict':
          throw new PayoutStatusConflictError(outcome.status, 'held');
        case 'referrer_blocked':
          throw new PayoutReferrerBlockedError();
        case 'pix_key_change_pending':
          throw new PayoutPixKeyChangePendingError();
        case 'still_held':
          throw new PayoutStillHeldError();
        case 'below_minimum':
          throw new PayoutBelowMinimumError(outcome.amountCents, outcome.minimumCents);
      }
    });
  }
}
