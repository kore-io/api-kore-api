/**
 * O push da cobrança (Publicar e pagar RN13; decisão 236): um job por pessoa
 * dona, depois do commit. O worker confere de novo o vínculo, a preferência
 * Push e os aparelhos; o texto não leva valor.
 */
export interface BillingPush {
  paymentConfirmed(input: { weddingId: string; userIds: readonly string[] }): Promise<void>;
}

export const BILLING_PUSH = Symbol('BillingPush');
