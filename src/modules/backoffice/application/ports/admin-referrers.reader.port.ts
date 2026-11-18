import type { StaffRole } from '@/modules/backoffice/domain/staff';
import type { AdminWeddingRow, Page } from './admin-weddings.reader.port';

/** Só a cerimonialista no lançamento: o vendedor fica fora (decisão 230, D17). */
export const ADMIN_REFERRER_KINDS = ['planner'] as const;
export type AdminReferrerKind = (typeof ADMIN_REFERRER_KINDS)[number];

export const ADMIN_REFERRER_STATUSES = ['active', 'blocked', 'inactive'] as const;
export type AdminReferrerStatus = (typeof ADMIN_REFERRER_STATUSES)[number];

/** Os saldos (Comissões do indicador RN02 e RN07), em centavos, somados no Postgres (G8). */
export interface AdminReferrerBalances {
  /** Comissão disponível: available fora de repasse, mais os ajustes sem repasse. */
  availableCents: number;
  /** Aguardando liberação. */
  pendingCents: number;
  /** Já recebido. */
  receivedCents: number;
  /** "(R$ 158,04 em repasse)": o que está num repasse ainda não pago. */
  inPayoutCents: number;
}

/** Uma linha da lista de Cerimonialistas (Backoffice - cobrança RN08; Penpot 11). */
export interface AdminReferrerRow {
  id: string;
  kind: AdminReferrerKind;
  /** O nome da pessoa ("Juliana Prado"). */
  name: string;
  /** O nome da assinatura e do destaque da indicação. */
  creditName: string | null;
  email: string;
  cities: string[];
  status: AdminReferrerStatus;
  /** Casais trazidos: os casamentos com ela de indicadora, sem a lápide. */
  couplesCount: number;
  balances: AdminReferrerBalances;
  /**
   * A tag "Repasse pedido": um repasse solicitado (`requested`); o retido fica
   * só na fila de Repasses (decisão 273(2)). Só para o Admin (decisão 69).
   */
  payoutRequested?: boolean;
}

export interface AdminReferrerListQuery {
  kind: AdminReferrerKind;
  status?: AdminReferrerStatus;
  hasPayout?: boolean;
  city?: string;
  page: number;
}

/** O cabeçalho do detalhe, igual em todas as abas. */
export interface AdminReferrerProfile extends AdminReferrerRow {
  createdAt: Date;
  /** O percentual em leitura ("20% · padrão das Configurações"; decisão 75). */
  ratePercent: number;
  taxIdType: 'cpf' | 'cnpj' | null;
  /** Cifrado; o caso de uso devolve só a máscara. */
  taxIdEncrypted: string | null;
  /** A chave Pix vigente, mascarada; só para o Admin (decisão 69). */
  pixKeyMasked?: string | null;
  block: {
    blockedAt: Date;
    blockedBy: { userId: string; name: string | null } | null;
    /** Do log `referrer.blocked`. */
    reason: string | null;
  } | null;
}

/** Uma linha do extrato (aba Comissões): a comissão de um pagamento ou um ajuste. */
export type AdminReferrerStatementEntry =
  | {
      kind: 'commission';
      id: string;
      createdAt: Date;
      /** Nulo com o casamento apagado (o link não abre). */
      weddingId: string | null;
      /** "Ana & Marcos"; nulo com o casamento apagado ou sem os nomes. */
      coupleNames: string | null;
      paymentKind: 'publication' | 'extension';
      baseAmountCents: number;
      ratePercent: number;
      amountCents: number;
      status: 'pending' | 'available' | 'paid' | 'reversed' | 'blocked' | 'held';
      blockReason: 'self_referral' | 'referrer_blocked' | 'admin' | 'wedding_blocked' | null;
      availableAt: Date;
      paidAt: Date | null;
      payoutId: string | null;
    }
  | {
      kind: 'adjustment';
      id: string;
      createdAt: Date;
      /** O "Ajuste manual" é o `manual`; os outros vêm do estorno ou da contestação da comissão paga. */
      reason: 'refund' | 'chargeback' | 'manual';
      amountCents: number;
      note: string | null;
      commissionId: string | null;
      payoutId: string | null;
      createdBy: { userId: string; name: string | null } | null;
    };

/** Um repasse da cerimonialista (aba Repasses; só Admin). */
export interface AdminReferrerPayout {
  id: string;
  status: 'requested' | 'held' | 'processing' | 'paid' | 'rejected';
  holdReason: string | null;
  amountCents: number;
  pixKeyMasked: string;
  requestedAt: Date;
  processingAt: Date | null;
  paidAt: Date | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
}

/** A leitura das Cerimonialistas pela conexão do backoffice (decisão 180(5)). */
export interface AdminReferrersReader {
  list(input: AdminReferrerListQuery & { role: StaffRole }): Promise<Page<AdminReferrerRow>>;
  /** Nulo sem o indicador (ou fora dos tipos do lançamento). */
  profile(input: { referrerId: string; role: StaffRole }): Promise<AdminReferrerProfile | null>;
  weddings(input: { referrerId: string; page: number }): Promise<Page<AdminWeddingRow>>;
  statement(input: {
    referrerId: string;
    page: number;
  }): Promise<Page<AdminReferrerStatementEntry>>;
  payouts(input: { referrerId: string; page: number }): Promise<Page<AdminReferrerPayout>>;
}

export const ADMIN_REFERRERS_READER = Symbol('AdminReferrersReader');
