import { daysBetween, localDate } from '@/shared/kernel/time/local-date';

/** Os status que a lista mostra (Meus casamentos RN02): os do banco, menos `purged`. */
export const MY_WEDDING_STATUSES = [
  'awaiting_couple',
  'draft',
  'published',
  'post_event',
  'grace',
  'expired',
] as const;
export type MyWeddingStatus = (typeof MY_WEDDING_STATUSES)[number];

/**
 * O filtro de status da lista (Comissões RN08; Contrato de API, decisão 275):
 * os status do banco mais o derivado Aguardando pagamento (rascunho com Pix
 * pendente, Publicar e pagar RN06).
 */
export const MY_WEDDING_FILTERS = [...MY_WEDDING_STATUSES, 'awaiting_payment'] as const;
export type MyWeddingFilter = (typeof MY_WEDDING_FILTERS)[number];

export type WeddingOrigin = 'created_by_me' | 'referral_link' | 'couple_invite';

/** Um casamento em que ela colabora, como o banco devolve (RN01). */
export interface CollaborationRow {
  weddingId: string;
  partnerNames: [string, string];
  eventDate: string | null;
  city: string;
  state: string;
  timezone: string;
  status: MyWeddingStatus;
  createdAt: Date;
  createdByUserId: string | null;
  referralSource: string | null;
  /** O `User` do indicador do casamento, se houver. */
  referrerUserId: string | null;
  rsvpDeadline: string | null;
  stats: {
    guestsTotal: number;
    confirmed: number;
    declined: number;
    pending: number;
    rsvpPercent: number;
  };
}

/** Grupos ativos e os não enviados, contados na leitura (RN06; decisão 224(4)). */
export interface DeliveryCounts {
  partiesTotal: number;
  partiesNotSent: number;
}

/** RN02: Criado por você, Pelo seu link ou Convite do casal. */
export function originOf({
  row,
  userId,
}: {
  row: CollaborationRow;
  userId: string;
}): WeddingOrigin {
  const mine = row.referrerUserId === userId;
  if (mine && row.referralSource === 'created_by_planner') return 'created_by_me';
  if (mine && row.referralSource === 'referral_link') return 'referral_link';
  return 'couple_invite';
}

const today = ({ row, now }: { row: CollaborationRow; now: Date }) =>
  localDate({ at: now, timezone: row.timezone });

/**
 * RN02 (decisão 308(2)): a proximidade de hoje, no fuso do casamento. Primeiro
 * os de data hoje ou futura, em ordem crescente; depois os de data passada,
 * do mais recente ao mais antigo; sem data no fim, do mais novo ao mais antigo
 * (`createdAt`).
 */
export function compareWeddings({
  now,
}: {
  now: Date;
}): (a: CollaborationRow, b: CollaborationRow) => number {
  const group = (row: CollaborationRow) => {
    if (!row.eventDate) return 2;
    return row.eventDate >= today({ row, now }) ? 0 : 1;
  };
  return (a, b) => {
    const byGroup = group(a) - group(b);
    if (byGroup !== 0) return byGroup;
    if (a.eventDate && b.eventDate)
      return group(a) === 0
        ? a.eventDate.localeCompare(b.eventDate)
        : b.eventDate.localeCompare(a.eventDate);
    return b.createdAt.getTime() - a.createdAt.getTime();
  };
}

/** RN03: na F6, só Ativos (todos menos pós-evento e expirado) e Aguardando o casal. */
export function summaryOf({ rows }: { rows: readonly CollaborationRow[] }): {
  active: number;
  awaitingCouple: number;
} {
  return {
    active: rows.filter((row) => row.status !== 'post_event' && row.status !== 'expired').length,
    awaitingCouple: rows.filter((row) => row.status === 'awaiting_couple').length,
  };
}

/**
 * RN05: publicado, prazo de resposta entre hoje e hoje + 7 dias no fuso do
 * casamento, com convidados e mais de 40% pendentes (exatamente 40% não acende).
 */
export function hasPendingResponsesAlert({
  row,
  now,
}: {
  row: CollaborationRow;
  now: Date;
}): boolean {
  if (row.status !== 'published' || !row.rsvpDeadline || row.stats.guestsTotal <= 0) return false;
  const days = daysBetween({ from: today({ row, now }), to: row.rsvpDeadline });
  if (days < 0 || days > 7) return false;
  return row.stats.pending * 100 > row.stats.guestsTotal * 40;
}

/** RN06: candidato a alerta de convites: publicado e com a data entre hoje e hoje + 90 dias. */
export function isInvitationsAlertCandidate({
  row,
  now,
}: {
  row: CollaborationRow;
  now: Date;
}): boolean {
  if (row.status !== 'published' || !row.eventDate) return false;
  const days = daysBetween({ from: today({ row, now }), to: row.eventDate });
  return days >= 0 && days <= 90;
}

/**
 * RN06 (D7 da decisão 223): com grupos ativos, nenhum enviado ou mais de 20%
 * não enviados (exatamente 20% não acende).
 */
export function hasInvitationsNotSentAlert({ counts }: { counts: DeliveryCounts }): boolean {
  if (counts.partiesTotal <= 0) return false;
  if (counts.partiesNotSent === counts.partiesTotal) return true;
  return counts.partiesNotSent * 100 > counts.partiesTotal * 20;
}
