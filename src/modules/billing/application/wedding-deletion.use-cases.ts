import { Inject, Injectable } from '@nestjs/common';
import { BackofficeTransaction } from '../../../shared/database/backoffice-transaction';
import { localDate } from '../../../shared/time/local-date';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { WeddingScope } from '../../access/application/wedding-scope.service';
import { WeddingNotFoundError } from '../../access/domain/access.errors';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import { requireRecentSession } from '../../access/domain/recent-session';
import {
  BillingWeddingBlockedError,
  ConfirmNameMismatchError,
  NoDeletionScheduledError,
  PaymentDisputedError,
  RefundInProgressError,
  RefundWindowOpenError,
} from '../domain/billing.errors';
import { confirmNameMatches, deletionDayFor } from '../domain/wedding-deletion';
import { BILLING_MAILER, type BillingMailer } from './ports/billing-mailer.port';
import { REFUND_QUEUE, type RefundQueue } from './ports/refund-queue.port';
import {
  type DeletionTarget,
  WEDDING_DELETION_STORE,
  type WeddingDeletionStore,
  type WeddingLifecycleView,
} from './ports/wedding-deletion.store.port';

const partnerNamesOf = (target: DeletionTarget): [string, string] => {
  const [first = '', second = ''] = target.weddingName.split(' & ');
  return [first, second];
};

/**
 * O que os dois casos de uso têm em comum: só o dono (`manage_billing`, a
 * autorização central, na transação do casamento), e depois o Wedding travado
 * numa transação do backoffice, porque as colunas da exclusão não são do
 * kore_app. O bloqueio vale antes de tudo (403 WEDDING_BLOCKED; Casamento
 * bloqueado RN02 e RN03: o Cancelar a exclusão não está na lista de exceções).
 */
@Injectable()
abstract class WeddingDeletionBase {
  constructor(
    protected readonly scope: WeddingScope,
    protected readonly authorization: WeddingAuthorization,
    protected readonly transaction: BackofficeTransaction,
    @Inject(WEDDING_DELETION_STORE) protected readonly store: WeddingDeletionStore,
  ) {}

  protected requireOwner({ userId, weddingId }: { userId: string; weddingId: string }) {
    return this.scope.run({
      userId,
      weddingId,
      work: () => this.authorization.require({ userId, weddingId, action: 'manage_billing' }),
    });
  }

  protected async lock({ weddingId }: { weddingId: string }): Promise<DeletionTarget> {
    const target = await this.store.lockWedding({ weddingId });
    if (!target) throw new WeddingNotFoundError();
    if (target.blocked) throw new BillingWeddingBlockedError();
    return target;
  }
}

/**
 * Excluir o casamento (Retenção e expurgo RN05, RN06 e RN08; decisão 230,
 * D14): sessão recente, o nome do casal digitado e as travas de dinheiro, na
 * transação, com o Wedding e os Payments travados nessa ordem. Grava
 * `deletionScheduledFor = hoje + 7` (no fuso do casamento) e quem pediu; o
 * status não muda (ortogonal, B5-1). Idempotente: com a exclusão já agendada,
 * devolve a mesma data. Depois do commit: o cancelamento dos pendentes pela
 * porta, por job com o id fixo (G1), e o e-mail às pessoas donas.
 */
@Injectable()
export class RequestWeddingDeletion extends WeddingDeletionBase {
  constructor(
    scope: WeddingScope,
    authorization: WeddingAuthorization,
    transaction: BackofficeTransaction,
    @Inject(WEDDING_DELETION_STORE) store: WeddingDeletionStore,
    @Inject(REFUND_QUEUE) private readonly queue: RefundQueue,
    @Inject(BILLING_MAILER) private readonly mailer: BillingMailer,
  ) {
    super(scope, authorization, transaction, store);
  }

  async execute({
    session,
    weddingId,
    confirmName,
    now,
  }: {
    session: Pick<AuthenticatedSession, 'userId' | 'authenticatedAt'>;
    weddingId: string;
    confirmName: string;
    now: Date;
  }): Promise<{ deletionScheduledFor: string }> {
    const userId = session.userId;
    await this.requireOwner({ userId, weddingId });
    requireRecentSession({ session, now });
    return this.transaction.run(async () => {
      const target = await this.lock({ weddingId });
      if (!confirmNameMatches({ confirmName, weddingName: target.weddingName }))
        throw new ConfirmNameMismatchError();
      // Os dois donos ao mesmo tempo: a segunda chamada recebe a mesma data.
      if (target.deletionScheduledFor) return { deletionScheduledFor: target.deletionScheduledFor };

      const money = await this.store.moneyLocks({ weddingId, now });
      if (money.refundableUntil) throw new RefundWindowOpenError(money.refundableUntil);
      if (money.refundInProgress) throw new RefundInProgressError();
      if (money.disputed) throw new PaymentDisputedError();

      const deletionScheduledFor = deletionDayFor({
        today: localDate({ at: now, timezone: target.timezone }),
      });
      await this.store.schedule({ weddingId, userId, deletionScheduledFor, now });
      for (const paymentId of money.pendingPaymentIds)
        this.transaction.schedule(() =>
          this.queue.enqueueCancel({ paymentId, reason: 'wedding_deletion' }),
        );
      const owners = await this.store.owners({ weddingId });
      const requester = owners.find((owner) => owner.userId === userId);
      const partnerNames = partnerNamesOf(target);
      for (const owner of owners)
        this.transaction.schedule(() =>
          this.mailer.deletionScheduled({
            notice: {
              to: owner.email,
              firstName: owner.firstName,
              requesterFirstName: requester?.firstName ?? partnerNames[0],
              deletionScheduledFor,
              partnerNames,
            },
          }),
        );
      return { deletionScheduledFor };
    });
  }
}

/**
 * Cancelar a exclusão (Retenção e expurgo RN05): qualquer dono, até o
 * expurgo. Zera a data e quem pediu; o status é o que as rotinas deixaram, e
 * o site volta ao ar se a `wedding_site_state` devolver `live`. Devolve o
 * bloco `lifecycle` para o app escolher o Toast.
 */
@Injectable()
export class CancelWeddingDeletion extends WeddingDeletionBase {
  async execute({
    userId,
    weddingId,
    now,
  }: {
    userId: string;
    weddingId: string;
    now: Date;
  }): Promise<WeddingLifecycleView> {
    await this.requireOwner({ userId, weddingId });
    return this.transaction.run(async () => {
      const target = await this.lock({ weddingId });
      if (!target.deletionScheduledFor) throw new NoDeletionScheduledError();
      await this.store.cancel({ weddingId, userId, now });
      return this.store.lifecycle({ weddingId });
    });
  }
}
