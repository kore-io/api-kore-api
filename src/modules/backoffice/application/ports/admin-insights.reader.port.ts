import type { StaffRole } from '../../domain/staff';
import type { AdminWeddingRow, Page } from './admin-weddings.reader.port';

/** Um mês do gráfico (AAAA-MM), no fuso de Brasília. */
export interface MonthPoint {
  month: string;
  value: number;
}

/**
 * A Visão geral (Backoffice - acesso RN04). Os campos de dinheiro só vêm para
 * o Admin (RN02; decisão 69): a Receita do mês, os Repasses pedidos e o
 * gráfico da receita.
 */
export interface AdminOverview {
  /** AAAA-MM do mês corrente, em Brasília. */
  month: string;
  weddingsCreated: number;
  weddingsPublished: number;
  /** Publicados no mês ÷ criados no mês, 0 a 100; nulo sem criados. */
  activationPercent: number | null;
  plannersActive: number;
  plannersNew: number;
  /** A média da taxa de resposta dos casamentos no ar com convidados; nula sem eles. */
  rsvpAveragePercent: number | null;
  openAlerts: number;
  charts: { created: MonthPoint[]; published: MonthPoint[]; revenueCents?: MonthPoint[] };
  /** Só para o Admin: sem os juros do cartão e sem cortesia, só pagamentos aplicados. */
  revenue?: { publicationsCents: number; extensionsCents: number };
  payoutsRequested?: { count: number; amountCents: number };
}

export interface AdminSearchReferrer {
  id: string;
  kind: 'planner' | 'seller';
  name: string;
  referralCode: string;
  status: string;
}

export interface AdminSearchResult {
  weddings: AdminWeddingRow[];
  referrers: AdminSearchReferrer[];
}

export interface AdminLogQuery {
  action?: string;
  userId?: string;
  weddingId?: string;
  from: Date;
  to: Date;
  page: number;
}

export interface AdminLogRow {
  id: string;
  createdAt: Date;
  action: string;
  actorKind: string;
  actorUserId: string | null;
  weddingId: string | null;
  supportSessionId: string | null;
  entityType: string | null;
  entityId: string | null;
  data: unknown;
  ipHashShort: string | null;
}

export interface AdminAlertRow {
  id: string;
  type: string;
  status: 'open' | 'resolved';
  createdAt: Date;
  weddingId: string | null;
  /** "Ana & Marcos"; nulo sem casamento ou com a lápide. */
  coupleNames: string | null;
  userId: string | null;
  /** A pessoa do alerta de usuário (o nome e o e-mail, para a tela 19). */
  user: { name: string | null; email: string | null } | null;
  entityType: string;
  entityId: string;
  data: unknown;
  resolvedAt: Date | null;
  resolvedByName: string | null;
}

/** As leituras do Backoffice pela conexão do backoffice (decisão 180(5)). */
export interface AdminInsightsReader {
  overview(input: { role: StaffRole; now: Date }): Promise<AdminOverview>;
  search(input: { term: string }): Promise<AdminSearchResult>;
  logs(input: AdminLogQuery): Promise<Page<AdminLogRow>>;
  alerts(input: {
    status: 'open' | 'resolved';
    types: string[];
    page: number;
  }): Promise<Page<AdminAlertRow> & { openCount: number }>;
  /** Resolve o alerta aberto de um dos tipos dados, com o log, numa transação. */
  resolveAlert(input: {
    alertId: string;
    types: string[];
    byUserId: string;
    ipHash: string | null;
    now: Date;
  }): Promise<'resolved' | 'already_resolved' | 'not_found'>;
}

export const ADMIN_INSIGHTS_READER = Symbol('AdminInsightsReader');
