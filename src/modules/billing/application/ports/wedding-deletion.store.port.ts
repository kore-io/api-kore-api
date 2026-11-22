/** O casamento travado para o Excluir (Retenção RN05 e RN06). */
export interface DeletionTarget {
  status: string;
  timezone: string | null;
  blocked: boolean;
  /** AAAA-MM-DD; nulo sem exclusão agendada. */
  deletionScheduledFor: string | null;
  /** "Ana & Marcos" (decisão 163). */
  weddingName: string;
}

/** As travas de dinheiro do Excluir (RN06), lidas com os pagamentos travados. */
export interface DeletionMoneyLocks {
  /** O fim do prazo de desistir do pagamento mais recente ainda dentro dele. */
  refundableUntil: Date | null;
  refundInProgress: boolean;
  disputed: boolean;
  /** Os Pix (e cartões) pendentes, para cancelar depois do commit. */
  pendingPaymentIds: string[];
}

/**
 * O Excluir o casamento pela transação corrente da BackofficeTransaction
 * (kore_backoffice): as colunas da exclusão não são do kore_app. A ordem
 * única de trava (Publicar e pagar RN18): o Wedding, depois os Payments.
 */
export interface WeddingDeletionStore {
  /** Trava o Wedding; nulo se não existe ou já é lápide. */
  lockWedding(input: { weddingId: string }): Promise<DeletionTarget | null>;
  /** Trava os pagamentos e lê as travas do CDC, do reembolso e da contestação. */
  moneyLocks(input: { weddingId: string; now: Date }): Promise<DeletionMoneyLocks>;
  schedule(input: {
    weddingId: string;
    userId: string;
    deletionScheduledFor: string;
    now: Date;
  }): Promise<void>;
  cancel(input: { weddingId: string; userId: string; now: Date }): Promise<void>;
  /** As pessoas donas que recebem o e-mail (o e-mail e o primeiro nome) e quem pediu. */
  owners(input: {
    weddingId: string;
  }): Promise<{ userId: string; email: string; firstName: string }[]>;
  /** O ciclo de vida do casamento depois do cancelamento (o bloco `lifecycle` do GET /v1/me). */
  lifecycle(input: { weddingId: string }): Promise<WeddingLifecycleView>;
}

export interface WeddingLifecycleView {
  status: string;
  blocked: boolean;
  endDate: string | null;
  graceUntil: string | null;
  expiredAt: string | null;
  deletionScheduledFor: string | null;
}

export const WEDDING_DELETION_STORE = Symbol('WeddingDeletionStore');
