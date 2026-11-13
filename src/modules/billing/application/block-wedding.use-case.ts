import { Inject, Injectable } from '@nestjs/common';
import { BackofficeTransaction } from '../../../shared/database/backoffice-transaction';
import { REFUND_QUEUE, type RefundQueue } from './ports/refund-queue.port';
import { WEDDING_BLOCKS, type WeddingBlocks } from './ports/wedding-blocks.port';

/**
 * Bloquear e desbloquear o casamento (Casamento bloqueado RN01, RN06 e RN08;
 * decisões 83, 86 e 89). A rota é do Admin e do suporte (Backoffice, PR 11).
 * - bloquear: numa transação do backoffice, trava o Wedding primeiro (a ordem
 *   única de Publicar e pagar RN18), grava `blockedAt` e quem bloqueou, e o log
 *   `wedding.blocked` com o motivo; o status não muda (é ortogonal). Depois do
 *   commit, cada Pix pendente sai para o cancelamento na porta, por job com o
 *   id fixo (G1; B8-5). Se for pago assim mesmo, vira pagamento sem destino.
 * - desbloquear: limpa o bloqueio e grava `wedding.unblocked`; as rotinas
 *   voltam na próxima rodada, e o pagamento estornado não é refeito.
 * Sem notificação ao casal nem à colaboradora (decisão 89).
 */
@Injectable()
export class BlockWedding {
  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(WEDDING_BLOCKS) private readonly blocks: WeddingBlocks,
    @Inject(REFUND_QUEUE) private readonly queue: RefundQueue,
  ) {}

  block({
    weddingId,
    byUserId,
    reason,
    now,
  }: {
    weddingId: string;
    byUserId: string;
    reason: string;
    now: Date;
  }): Promise<'blocked' | 'already_blocked' | 'not_found'> {
    return this.transaction.run(async () => {
      const result = await this.blocks.block({ weddingId, byUserId, reason, now });
      if (result !== 'blocked') return result;
      for (const paymentId of await this.blocks.pendingPaymentIds({ weddingId }))
        this.transaction.schedule(() => this.queue.enqueueCancel({ paymentId }));
      return result;
    });
  }

  unblock({
    weddingId,
    byUserId,
    reason,
    now,
  }: {
    weddingId: string;
    byUserId: string;
    reason: string | null;
    now: Date;
  }): Promise<'unblocked' | 'not_blocked' | 'not_found'> {
    return this.transaction.run(() => this.blocks.unblock({ weddingId, byUserId, reason, now }));
  }
}
