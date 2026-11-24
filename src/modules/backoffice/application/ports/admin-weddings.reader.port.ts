import type { AdminLogRow } from './admin-insights.reader.port';
import type { StaffRole } from '@/modules/backoffice/domain/staff';

/** Os status do filtro da lista (RN05; decisão 251(3)): o Bloqueado vale por cima do status. */
export const ADMIN_WEDDING_FILTERS = [
  'awaiting_couple',
  'draft',
  'awaiting_payment',
  'published',
  'grace',
  'post_event',
  'expired',
  'blocked',
] as const;
export type AdminWeddingFilter = (typeof ADMIN_WEDDING_FILTERS)[number];

/** O filtro de RSVP (decisão 251(1); Penpot 05): Todos · Abaixo de 50% · A partir de 50%. */
export const RSVP_FILTERS = ['below_50', 'from_50'] as const;
export type RsvpFilter = (typeof RSVP_FILTERS)[number];

/** Quem trouxe o casamento (decisão 251(2)): Casal (sem indicador) · Cerimonialista · Vendedor. */
export type WeddingOrigin = 'couple' | 'planner' | 'seller';

export interface AdminReferrer {
  id: string;
  kind: 'planner' | 'seller';
  name: string;
}

export interface AdminWeddingRow {
  id: string;
  /** "Ana & Marcos". */
  coupleNames: string;
  slug: string | null;
  /** AAAA-MM-DD. */
  eventDate: string | null;
  /** O status guardado no casamento. */
  status: string;
  /** O que a lista mostra: o Bloqueado e o Aguardando pagamento por cima do status (RN05). */
  displayStatus: AdminWeddingFilter;
  blocked: boolean;
  origin: WeddingOrigin;
  referralSource: string | null;
  referrer: AdminReferrer | null;
  /** A taxa de resposta, 0 a 100; nula sem convidados ("—"). */
  rsvpPercent: number | null;
  /** A saída do ar, AAAA-MM-DD. */
  endDate: string | null;
}

export interface AdminWeddingListQuery {
  status?: AdminWeddingFilter;
  /** AAAA-MM-DD, pela data do casamento. */
  eventFrom?: string;
  eventTo?: string;
  rsvp?: RsvpFilter;
  referrerId?: string;
  page: number;
}

export interface AdminWeddingGeneral extends AdminWeddingRow {
  createdAt: Date;
  people: {
    userId: string;
    name: string | null;
    email: string;
    role: 'owner' | 'collaborator';
    /**
     * Até quando a pessoa não troca chave Pix nem remove membros, depois de o
     * staff trocar o e-mail de acesso (decisão 253(2)); nulo fora das 48 h.
     */
    accessChangeLockedUntil: Date | null;
    /** Desde quando tem acesso ao casamento: a data do vínculo (Pessoas com acesso; 316(11)(f)). */
    since: Date;
    /**
     * Até quando uma nova troca do e-mail desta pessoa é só do Admin (a 2ª em
     * 7 dias; Backoffice - acesso RN09 e decisão 253(1)); nula fora da janela.
     */
    accessEmailAdminOnlyUntil: Date | null;
  }[];
  /**
   * O Dialog da troca do e-mail de acesso (RN09; decisão 316(11)(b)): se pede
   * os 4 últimos do CPF de quem pagou e até quando as 3 conferências erradas
   * travam a troca.
   */
  accessEmailChange: { payerCheck: boolean; lockedUntil: Date | null };
  publishedAt: Date | null;
  graceUntil: string | null;
  purgeAt: string | null;
  deletionScheduledFor: string | null;
  /** O Pix pendente (só para o Admin; RN02 e RN06). */
  pendingPayment: {
    paymentId: string;
    method: 'pix' | 'card';
    amountCents: number;
    createdAt: Date;
  } | null;
  block: {
    blockedAt: Date;
    blockedBy: { userId: string; name: string | null } | null;
    /** O motivo, do log `wedding.blocked` (decisão 82: fica fora do casamento). */
    reason: string | null;
  } | null;
}

export interface AdminWeddingTombstone {
  id: string;
  status: 'purged';
  purgedAt: Date | null;
  referrer: AdminReferrer | null;
  referralSource: string | null;
  createdAt: Date;
}

export interface AdminWeddingNumbers {
  guestsTotal: number;
  confirmed: number;
  declined: number;
  pending: number;
  adultsConfirmed: number;
  childrenConfirmed: number;
  babiesConfirmed: number;
  partiesPending: number;
  rsvpPercent: number | null;
}

export interface AdminWeddingGuest {
  guestId: string;
  partyId: string;
  partyName: string;
  name: string | null;
  /** Na lixeira: a remoção a pedido do titular vale também (RN10). */
  inTrash: boolean;
}

export interface AdminWeddingLogEntry {
  id: string;
  createdAt: Date;
  action: string;
  actorKind: string;
  actorUserId: string | null;
  entityType: string | null;
  entityId: string | null;
  data: unknown;
  /** O hash do IP, curto (RN06). */
  ipHashShort: string | null;
  /** Quem agiu, como no Log da aplicação (decisões 316(11)(c) e 320(2)). */
  actor: AdminLogRow['actor'];
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** A leitura do Backoffice pela conexão do backoffice (decisão 180(5)). */
export interface AdminWeddingsReader {
  list(input: AdminWeddingListQuery): Promise<Page<AdminWeddingRow>>;
  /** Nulo sem o casamento; a lápide quando expurgado. */
  general(input: {
    weddingId: string;
    role: StaffRole;
  }): Promise<AdminWeddingGeneral | AdminWeddingTombstone | null>;
  numbers(input: { weddingId: string }): Promise<AdminWeddingNumbers | null>;
  guests(input: { weddingId: string; page: number }): Promise<Page<AdminWeddingGuest> | null>;
  /** A aba Log; `hiddenActionPrefixes`: as ações que o papel não lê (decisão 69). */
  log(input: {
    weddingId: string;
    page: number;
    hiddenActionPrefixes?: string[];
  }): Promise<Page<AdminWeddingLogEntry> | null>;
}

export const ADMIN_WEDDINGS_READER = Symbol('AdminWeddingsReader');
