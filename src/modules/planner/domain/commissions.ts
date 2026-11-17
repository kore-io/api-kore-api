/** Uma comissão como a indicadora a lê (Comissões do indicador RN07 e RN10). */
export interface CommissionRow {
  id: string;
  weddingId: string;
  weddingPurged: boolean;
  partnerNames: [string, string] | null;
  clickable: boolean;
  paymentKind: 'publication' | 'extension';
  baseAmountCents: number;
  amountCents: number;
  ratePercent: number;
  status: 'pending' | 'available' | 'paid' | 'reversed' | 'blocked' | 'held';
  availableAt: Date;
  paidAt: Date | null;
  createdAt: Date;
  payoutId: string | null;
  /** O motivo do bloqueio (o contrato devolve; a tela mostra só a legenda, RN07). */
  blockReason: 'self_referral' | 'referrer_blocked' | 'admin' | null;
}

export interface CommissionBalances {
  /** Disponível: available fora de repasse (RN02; mais os ajustes, no PR do repasse). */
  availableCents: number;
  /** Aguardando liberação. */
  pendingCents: number;
  /** Já recebido. */
  receivedCents: number;
  /** "(R$ 158,04 em repasse)": available dentro de um repasse ainda não pago. */
  inPayoutCents: number;
}

/** Um ajuste da comissão (o negativo do estorno da já paga, ou o manual do Admin). */
export interface AdjustmentRow {
  id: string;
  /** refund · chargeback · manual (o do Admin). */
  reason: string;
  createdAt: Date;
  amountCents: number;
  payoutId: string | null;
  /** O estado do repasse em que o ajuste entrou; nulo sem repasse. */
  payoutStatus: 'requested' | 'held' | 'processing' | 'paid' | 'rejected' | null;
}

/**
 * Os saldos (RN02 e RN07): `blocked`, `held` e `reversed` ficam fora. O
 * Disponível soma os ajustes sem repasse (invariante 7; B6-2); o ajuste num
 * repasse pago soma no Já recebido, e o de um repasse ainda não pago, no "em
 * repasse" (a mesma regra do Backoffice, RN08).
 */
export function commissionBalances(
  rows: readonly CommissionRow[],
  adjustments: readonly AdjustmentRow[] = [],
): CommissionBalances {
  const sum = (filter: (row: CommissionRow) => boolean) =>
    rows.filter(filter).reduce((total, row) => total + row.amountCents, 0);
  const adjusted = (place: 'none' | 'open' | 'paid') =>
    adjustments
      .filter((adjustment) =>
        adjustment.payoutId === null
          ? place === 'none'
          : adjustment.payoutStatus === 'paid'
            ? place === 'paid'
            : place === 'open',
      )
      .reduce((total, adjustment) => total + adjustment.amountCents, 0);
  return {
    availableCents:
      sum((row) => row.status === 'available' && row.payoutId === null) + adjusted('none'),
    pendingCents: sum((row) => row.status === 'pending'),
    receivedCents: sum((row) => row.status === 'paid') + adjusted('paid'),
    inPayoutCents:
      sum((row) => row.status === 'available' && row.payoutId !== null) + adjusted('open'),
  };
}

export interface WeddingCommissions {
  weddingId: string;
  weddingPurged: boolean;
  partnerNames: [string, string] | null;
  clickable: boolean;
  availableCents: number;
  pendingCents: number;
  /** As datas de liberação das que aguardam ("Libera em 09/09" · "libera em 02/10 e em 10/10"). */
  releaseDates: Date[];
}

/**
 * A aba Por casamento (RN07): a soma por casal; Estornada, Bloqueada e Retida
 * não entram (RN08, a mesma regra da coluna do Link de indicação).
 */
export function commissionsByWedding(rows: readonly CommissionRow[]): WeddingCommissions[] {
  const byWedding = new Map<string, WeddingCommissions>();
  for (const row of rows) {
    const entry =
      byWedding.get(row.weddingId) ??
      byWedding
        .set(row.weddingId, {
          weddingId: row.weddingId,
          weddingPurged: row.weddingPurged,
          partnerNames: row.partnerNames,
          clickable: row.clickable,
          availableCents: 0,
          pendingCents: 0,
          releaseDates: [],
        })
        .get(row.weddingId)!;
    if (row.status === 'available' && row.payoutId === null)
      entry.availableCents += row.amountCents;
    if (row.status === 'pending') {
      entry.pendingCents += row.amountCents;
      entry.releaseDates.push(row.availableAt);
    }
  }
  for (const entry of byWedding.values())
    entry.releaseDates.sort((left, right) => left.getTime() - right.getTime());
  return [...byWedding.values()];
}

/** "Ana & Marcos": os primeiros nomes do casal; nulo no casamento apagado (RN07; B5-8). */
export function commissionCoupleNames(partnerNames: [string, string] | null): string | null {
  if (!partnerNames) return null;
  const names = partnerNames.map((name) => name.trim()).filter(Boolean);
  return names.length > 0 ? names.join(' & ') : null;
}

/** Uma linha da aba Por pagamento: a comissão ou o ajuste (em vermelho, sem selo; RN07). */
export type CommissionPaymentLine =
  | { kind: 'commission'; at: Date; commission: CommissionRow }
  | { kind: 'adjustment'; at: Date; adjustment: AdjustmentRow };

/** A aba Por pagamento: as comissões e os ajustes juntos, o mais novo primeiro. */
export function commissionPaymentLines({
  rows,
  adjustments,
}: {
  rows: readonly CommissionRow[];
  adjustments: readonly AdjustmentRow[];
}): CommissionPaymentLine[] {
  return [
    ...rows.map((commission) => ({
      kind: 'commission' as const,
      at: commission.createdAt,
      commission,
    })),
    ...adjustments.map((adjustment) => ({
      kind: 'adjustment' as const,
      at: adjustment.createdAt,
      adjustment,
    })),
  ].sort((left, right) => right.at.getTime() - left.at.getTime());
}

export interface ReferredCommission {
  totalCents: number;
  /** A soma de cada estado, na ordem Disponível · Aguardando · Paga; sem os vazios. */
  byStatus: { status: 'available' | 'pending' | 'paid'; amountCents: number }[];
}

/**
 * A coluna Comissão do Link de indicação (RN08; Contrato de API): a soma das
 * comissões do casal com os estados; Estornada, Bloqueada e Retida não entram.
 * A disponível que está num repasse aberto continua disponível (o status dela).
 */
export function referredCommission(rows: readonly CommissionRow[]): ReferredCommission {
  const byStatus = (['available', 'pending', 'paid'] as const)
    .map((status) => ({
      status,
      amountCents: rows
        .filter((row) => row.status === status)
        .reduce((total, row) => total + row.amountCents, 0),
    }))
    .filter((entry) => rows.some((row) => row.status === entry.status));
  return {
    totalCents: byStatus.reduce((total, entry) => total + entry.amountCents, 0),
    byStatus,
  };
}
