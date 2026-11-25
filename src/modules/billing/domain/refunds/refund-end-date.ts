/**
 * A data para onde a `endDate` volta se a extensão for desistida (Pagamentos e
 * arrependimento RN03; decisão 327(2)): `min(endDate atual, previousEndDate)`,
 * o mesmo `LEAST` da `apply_payment_refund` (o `min` cobre o casal que
 * antecipou depois de pagar). Nulo na publicação e no que não é desistível
 * (fora de `paid` ou fora do prazo de 7 dias, RN02).
 */
export function refundEndDate({
  kind,
  refundable,
  endDate,
  previousEndDate,
}: {
  kind: 'publication' | 'extension';
  refundable: boolean;
  /** A `endDate` atual do casamento, AAAA-MM-DD. */
  endDate: string | null;
  /** A gravada na confirmação da extensão, AAAA-MM-DD. */
  previousEndDate: string | null;
}): string | null {
  if (kind !== 'extension' || !refundable) return null;
  // Como o LEAST do Postgres, o nulo fica de fora.
  if (endDate === null) return previousEndDate;
  if (previousEndDate === null) return endDate;
  return previousEndDate < endDate ? previousEndDate : endDate;
}
