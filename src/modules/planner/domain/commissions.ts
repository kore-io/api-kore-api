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
}

export interface CommissionBalances {
  /** Disponível: available fora de repasse (RN02; mais os ajustes, no PR do repasse). */
  availableCents: number;
  /** Aguardando liberação. */
  pendingCents: number;
  /** Já recebido. */
  receivedCents: number;
  /** "(R$ 158,04 em repasse)": available dentro de um repasse pedido. */
  inPayoutCents: number;
}

/** Um ajuste da comissão (o negativo do estorno da já paga, ou o manual do Admin). */
export interface AdjustmentRow {
  amountCents: number;
  payoutId: string | null;
}

/**
 * Os saldos (RN02 e RN07): `blocked`, `held` e `reversed` ficam fora. O
 * Disponível soma os ajustes sem repasse (invariante 7; B6-2), e o "em
 * repasse", os que estão num repasse.
 */
export function commissionBalances(
  rows: readonly CommissionRow[],
  adjustments: readonly AdjustmentRow[] = [],
): CommissionBalances {
  const sum = (filter: (row: CommissionRow) => boolean) =>
    rows.filter(filter).reduce((total, row) => total + row.amountCents, 0);
  const adjusted = (inPayout: boolean) =>
    adjustments
      .filter((adjustment) => (adjustment.payoutId !== null) === inPayout)
      .reduce((total, adjustment) => total + adjustment.amountCents, 0);
  return {
    availableCents:
      sum((row) => row.status === 'available' && row.payoutId === null) + adjusted(false),
    pendingCents: sum((row) => row.status === 'pending'),
    receivedCents: sum((row) => row.status === 'paid'),
    inPayoutCents:
      sum((row) => row.status === 'available' && row.payoutId !== null) + adjusted(true),
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
