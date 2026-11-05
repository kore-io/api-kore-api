export type ReferrerKind = 'planner' | 'seller';
export type ReferrerStatus = 'active' | 'blocked' | 'inactive';
export type AccountStatus = 'active' | 'blocked';

/** O indicador de um link de indicação, como está guardado. */
export interface ReferrerRecord {
  referralCode: string;
  kind: ReferrerKind;
  status: ReferrerStatus;
  accountStatus: AccountStatus;
  /** Planner.creditName no cerimonialista; nome da conta no vendedor. */
  displayName: string | null;
  referralDiscountEnabled: boolean;
}

/** O destaque "Indicação de {nome}" do cadastro (RN08 e RN09 de Cadastro). */
export interface Referral {
  code: string;
  referrerName: string;
  kind: ReferrerKind;
  /** Nulo quando o indicador está com o desconto desligado (RN09). */
  discountPercent: number | null;
}

/**
 * RN08: só indicador ativo, com a conta ativa (decisão 162), vale; o resto é
 * tratado como código inexistente. Sem nome não há o que destacar, e o
 * cadastro segue sem indicação.
 */
export function toReferral({
  referrer,
  referralDiscountPercent,
}: {
  referrer: ReferrerRecord;
  referralDiscountPercent: number;
}): Referral | null {
  if (referrer.status !== 'active' || referrer.accountStatus !== 'active') return null;
  if (!referrer.displayName) return null;
  return {
    code: referrer.referralCode,
    referrerName: referrer.displayName,
    kind: referrer.kind,
    discountPercent: referrer.referralDiscountEnabled ? referralDiscountPercent : null,
  };
}
