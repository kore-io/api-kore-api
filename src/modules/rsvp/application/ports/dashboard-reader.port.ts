import type { DeliveryCounts, ReminderQueue } from '../../domain/dashboard';

export interface DashboardStats {
  guestsTotal: number;
  confirmed: number;
  declined: number;
  pending: number;
  adultsConfirmed: number;
  childrenConfirmed: number;
  babiesConfirmed: number;
  partiesPending: number;
  rsvpPercent: number;
}

export interface DashboardWedding {
  status: string;
  slug: string | null;
  timezone: string | null;
  /** AAAA-MM-DD. */
  eventDate: string | null;
  rsvpDeadline: string | null;
  endDate: string | null;
  publishedAt: Date | null;
  appearanceSetAt: Date | null;
}

/** Uma resposta do grupo, como a Atividade recente mostra (só o grupo e os números). */
export interface ActivityGroup {
  partyId: string;
  name: string;
  confirmed: number;
  declined: number;
  at: string;
}

/**
 * Uma linha da Atividade recente (Dashboard RN04): uma notificação do usuário
 * (dono) ou, para a colaboradora até a F6, uma gravação do grupo (R6-3).
 */
export interface ActivityRow {
  source: 'notification' | 'submission';
  id: string;
  /** Grupos distintos (1 na gravação). */
  count: number;
  groups: ActivityGroup[];
  readAt: Date | null;
  at: Date;
}

/** As leituras do Dashboard, na transação da requisição (RLS do vínculo). */
export interface DashboardReader {
  wedding({ weddingId }: { weddingId: string }): Promise<DashboardWedding | null>;
  stats({ weddingId }: { weddingId: string }): Promise<DashboardStats>;
  /** Uma consulta agrupada pelos grupos ativos (o índice parcial do status de envio). */
  delivery({ weddingId }: { weddingId: string }): Promise<DeliveryCounts>;
  reminderQueue({ weddingId }: { weddingId: string }): Promise<ReminderQueue>;
  /** As 5 notificações mais recentes do usuário neste casamento, lidas ou não. */
  notifications({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<ActivityRow[]>;
  /** As 5 últimas gravações do grupo (`actor = party`) do casamento. */
  partySubmissions({ weddingId }: { weddingId: string }): Promise<ActivityRow[]>;
}

export const DASHBOARD_READER = Symbol('DashboardReader');
