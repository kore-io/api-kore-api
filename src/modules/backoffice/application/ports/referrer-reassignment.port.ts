export type ReassignResult =
  | { result: 'reassigned' | 'unchanged' }
  | { result: 'not_found' | 'payment_pending' | 'referrer_not_active' | 'self_referral' }
  | { result: 'already_paid'; paidAt: Date };

/**
 * Reatribuir o indicador (Backoffice - acesso RN07), numa transação do
 * backoffice com o Wedding travado (a ordem única de Publicar e pagar RN18):
 * só antes da publicação paga e sem pagamento pendente; o novo indicador
 * ativo (ou nenhum); `referralSource = admin_reassigned`, o log e a
 * notificação `referrer_reassigned` aos dois indicadores (decisão 80).
 */
export interface ReferrerReassignment {
  reassign(input: {
    weddingId: string;
    referrerId: string | null;
    byUserId: string;
    reason: string;
    ipHash: string | null;
    now: Date;
  }): Promise<ReassignResult>;
}

export const REFERRER_REASSIGNMENT = Symbol('ReferrerReassignment');
