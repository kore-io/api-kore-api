import { daysBetween, localDate } from '../../../shared/time/local-date';

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

/** RN02: a data mais próxima primeiro; sem data, no fim, do mais novo para o mais antigo. */
export function compareWeddings(a: CollaborationRow, b: CollaborationRow): number {
  if (a.eventDate && b.eventDate) return a.eventDate.localeCompare(b.eventDate);
  if (a.eventDate) return -1;
  if (b.eventDate) return 1;
  return b.createdAt.getTime() - a.createdAt.getTime();
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

const today = ({ row, now }: { row: CollaborationRow; now: Date }) =>
  localDate({ at: now, timezone: row.timezone });

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
