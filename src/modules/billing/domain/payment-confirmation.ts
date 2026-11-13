/** O casamento como a confirmação o vê, já travado (RN18: Wedding antes de Payment). */
export interface ConfirmingWedding {
  status: string;
  blockedAt: Date | null;
  deletionScheduledFor: string | null;
  /** A extensão confere a base dela (B2-9): AAAA-MM-DD. */
  endDate?: string | null;
  paidThrough?: string | null;
}

export interface ConfirmingPayment {
  kind: 'publication' | 'extension';
  /** O início dos meses cobertos, AAAA-MM-DD (a extensão confere com o casamento). */
  periodStart?: string;
  status: 'pending' | 'paid' | 'failed' | 'canceled' | 'refund_requested' | 'refunded' | 'disputed';
  amountCents: number;
}

export type OrphanReason =
  | 'wedding_not_draft'
  | 'wedding_blocked'
  | 'wedding_deletion_scheduled'
  | 'already_published'
  | 'payment_canceled'
  | 'payment_failed'
  | 'extension_stale'
  | 'wedding_not_published';

export type ConfirmationDecision =
  /** O mesmo fato de novo (confirmado e recebido): nada (RN09). */
  | { kind: 'already_confirmed' }
  /** Pago e aplicado (RN05); com o alerta quando o gateway cobrou a mais (RN09). */
  | { kind: 'apply'; overcharged: boolean }
  /** Recebido a menos: pago, não aplicado; o Admin decide (RN09; B2-7). */
  | { kind: 'undercharged' }
  /** Pago e sem destino: estorno automático e alerta (RN08). */
  | { kind: 'orphan'; reason: OrphanReason };

/**
 * A confirmação de uma cobrança (Publicar e pagar RN05, RN08, RN09 e RN10;
 * decisão 231, B2-2 e B2-7). Compara o total cobrado, nunca a parcela. A
 * extensão só se aplica com a base em que foi cotada (B2-9 e B4-8).
 */
export function decideConfirmation({
  payment,
  wedding,
  chargedCents,
  otherPublicationApplied,
}: {
  payment: ConfirmingPayment;
  wedding: ConfirmingWedding;
  chargedCents: number;
  otherPublicationApplied: boolean;
}): ConfirmationDecision {
  if (['paid', 'refund_requested', 'refunded', 'disputed'].includes(payment.status))
    return { kind: 'already_confirmed' };
  // O Pix cancelado ou o cartão recusado que o gateway confirma depois (B2-2).
  if (payment.status === 'canceled') return { kind: 'orphan', reason: 'payment_canceled' };
  if (payment.status === 'failed') return { kind: 'orphan', reason: 'payment_failed' };
  // Casamento bloqueado que pagou: estorno automático (B2-20; decisão 83).
  if (wedding.blockedAt) return { kind: 'orphan', reason: 'wedding_blocked' };
  if (wedding.deletionScheduledFor) return { kind: 'orphan', reason: 'wedding_deletion_scheduled' };
  if (payment.kind === 'publication') {
    if (otherPublicationApplied) return { kind: 'orphan', reason: 'already_published' };
    if (wedding.status !== 'draft') return { kind: 'orphan', reason: 'wedding_not_draft' };
  }
  if (payment.kind === 'extension') {
    if (!['published', 'post_event', 'grace', 'expired'].includes(wedding.status))
      return { kind: 'orphan', reason: 'wedding_not_published' };
    // A base da extensão é a do casamento agora (B2-9; Data de saída do ar
    // RN04): o maior entre a endDate e o paidThrough. No expirado, vale também
    // a cotada no expirado (a partir de hoje, depois da base) e a cotada na
    // carência e paga já no expirado (B4-8).
    const end = wedding.endDate ?? '';
    const base = wedding.paidThrough && wedding.paidThrough > end ? wedding.paidThrough : end;
    const start = payment.periodStart ?? '';
    const fits = wedding.status === 'expired' ? start >= base : start === base;
    if (!fits) return { kind: 'orphan', reason: 'extension_stale' };
  }
  if (chargedCents < payment.amountCents) return { kind: 'undercharged' };
  return { kind: 'apply', overcharged: chargedCents > payment.amountCents };
}
