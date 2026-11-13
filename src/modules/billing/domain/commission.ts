/**
 * A comissão do indicador (Comissões do indicador RN01, RN03 e RN04; decisão
 * 230, D2 e D4; revisão técnica B1-3 e B6-1): calculada uma vez, na aplicação
 * do pagamento, em centavos inteiros, e nunca recalculada.
 */
export interface CommissionInput {
  /** O total pago (com os juros do cartão). */
  amountCents: number;
  installmentInterestCents: number;
  /** O percentual do indicador na data do pagamento. */
  ratePercent: number;
  referrerStatus: 'active' | 'blocked' | 'inactive';
  /** O HMAC do CPF/CNPJ do indicador, quando cadastrado (Repasse RN02). */
  referrerTaxIdHash: string | null;
  payerTaxIdHash: string;
}

export type NewCommission =
  | { kind: 'none' }
  | {
      kind: 'create';
      baseAmountCents: number;
      amountCents: number;
      status: 'pending' | 'blocked';
      blockReason: 'self_referral' | 'referrer_blocked' | null;
    };

/**
 * - **base** = o pago sem os juros do cartão (já com os descontos de indicação e
 *   do Pix);
 * - **valor** = `(base × percentual + 50) div 100`: ao centavo, meio para cima;
 * - **zero não nasce** (o 0% aceito pelo Admin; B6-1);
 * - **autoindicação** (o HMAC do indicador igual ao do pagador): nasce
 *   `blocked`, `self_referral` (RN03);
 * - **indicador bloqueado ou inativo**: nasce `blocked`, `referrer_blocked` (RN04).
 */
export function newCommission(input: CommissionInput): NewCommission {
  const baseAmountCents = input.amountCents - input.installmentInterestCents;
  const amountCents = Math.floor((baseAmountCents * input.ratePercent + 50) / 100);
  if (amountCents <= 0) return { kind: 'none' };
  const selfReferral =
    input.referrerTaxIdHash !== null && input.referrerTaxIdHash === input.payerTaxIdHash;
  if (selfReferral)
    return {
      kind: 'create',
      baseAmountCents,
      amountCents,
      status: 'blocked',
      blockReason: 'self_referral',
    };
  if (input.referrerStatus !== 'active')
    return {
      kind: 'create',
      baseAmountCents,
      amountCents,
      status: 'blocked',
      blockReason: 'referrer_blocked',
    };
  return { kind: 'create', baseAmountCents, amountCents, status: 'pending', blockReason: null };
}
