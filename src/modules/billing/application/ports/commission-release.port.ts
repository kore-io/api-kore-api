export interface ReleasedCommission {
  id: string;
  referrerUserId: string;
  weddingId: string;
  amountCents: number;
}

/**
 * A liberação das comissões (Comissões do indicador RN02 e RN09), pela conexão
 * do backoffice: numa transação, `pending → available` quando a data do
 * `availableAt` no fuso de São Paulo chega (não a hora; B6-5), e a notificação
 * `commission` à pessoa indicadora. `referrerId` recorta a rodada (o teste).
 */
export interface CommissionRelease {
  release(input: { now: Date; referrerId?: string }): Promise<ReleasedCommission[]>;
}

export const COMMISSION_RELEASE = Symbol('CommissionRelease');
