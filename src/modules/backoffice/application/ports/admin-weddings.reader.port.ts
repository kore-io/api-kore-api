import type { StaffRole } from '../../domain/staff';

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
  people: { userId: string; name: string | null; email: string; role: 'owner' | 'collaborator' }[];
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
  log(input: { weddingId: string; page: number }): Promise<Page<AdminWeddingLogEntry> | null>;
}

export const ADMIN_WEDDINGS_READER = Symbol('AdminWeddingsReader');
