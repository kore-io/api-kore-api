import { ApiProperty } from '@nestjs/swagger';
import type { DashboardView } from '../application/dashboard.use-case';

class DashboardStatsResponse {
  /** Pessoas e vagas (Grupos RN13). */
  guestsTotal: number;
  confirmed: number;
  declined: number;
  pending: number;
  adultsConfirmed: number;
  childrenConfirmed: number;
  babiesConfirmed: number;
  partiesPending: number;
  /** (confirmados + recusados) ÷ total, em porcentagem. */
  rsvpPercent: number;
  /** A soma do `delivery` (R6-5). */
  partiesTotal: number;
}

class DashboardDeliveryResponse {
  notSent: number;
  sent: number;
  viewed: number;
  responded: number;
}

class DashboardReminderQueueResponse {
  /** Grupos já enviados com convidado com nome pendente. */
  parties: number;
  /** Os convidados com nome pendentes nesses grupos (a vaga não conta). */
  guests: number;
  /** Grupos da fila sem lembrete depois do convite. */
  notReminded: number;
}

class DashboardSiteResponse {
  status: string;
  @ApiProperty({ type: String, nullable: true }) slug: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) publishedAt: string | null;
  /** A data de saída do ar ("No ar até {data}."). */
  @ApiProperty({ type: String, nullable: true, example: '2027-02-14' }) endDate: string | null;
}

class ChecklistProgressResponse {
  done: number;
  total: number;
}

class ChecklistItemResponse {
  @ApiProperty({ enum: ['guests', 'appearance', 'publish', 'invites', 'reminders'] })
  key: 'guests' | 'appearance' | 'publish' | 'invites' | 'reminders';
  done: boolean;
  /** Envios: grupos enviados de todos; lembrete: grupos da fila já lembrados. */
  @ApiProperty({ type: ChecklistProgressResponse, nullable: true })
  progress: ChecklistProgressResponse | null;
}

class ActivityGroupResponse {
  partyId: string;
  name: string;
  confirmed: number;
  declined: number;
  @ApiProperty({ format: 'date-time' }) at: string;
}

class ActivityResponse {
  /** A notificação do dono, ou a gravação do grupo para a colaboradora (até a F6). */
  @ApiProperty({ enum: ['notification', 'submission'] }) source: 'notification' | 'submission';
  id: string;
  count: number;
  /** Só o grupo e os números: sem restrição nem nome de convidado. */
  @ApiProperty({ type: [ActivityGroupResponse] }) groups: ActivityGroupResponse[];
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) readAt: string | null;
  @ApiProperty({ format: 'date-time' }) at: string;
}

/** O Dashboard do casal (Dashboard RN01 a RN08). */
export class DashboardResponse {
  /** Quem lê: a colaboradora vê a faixa "Você colabora neste casamento." (RN01). */
  @ApiProperty({ enum: ['owner', 'collaborator'] }) role: 'owner' | 'collaborator';
  @ApiProperty({ type: DashboardStatsResponse }) stats: DashboardStatsResponse;
  @ApiProperty({ type: DashboardDeliveryResponse }) delivery: DashboardDeliveryResponse;
  @ApiProperty({ type: DashboardReminderQueueResponse })
  reminderQueue: DashboardReminderQueueResponse;
  @ApiProperty({ type: DashboardSiteResponse }) site: DashboardSiteResponse;
  @ApiProperty({ type: String, nullable: true, example: '2026-10-15' }) rsvpDeadline: string | null;
  @ApiProperty({ type: String, nullable: true, example: '2026-11-14' }) eventDate: string | null;
  /** Dias até o casamento, no fuso dele; 0 no dia; negativo depois; nulo sem data. */
  @ApiProperty({ type: Number, nullable: true }) daysUntilEvent: number | null;
  /** Na ordem da RN03; o lembrete aparece depois do 1º envio. */
  @ApiProperty({ type: [ChecklistItemResponse] }) checklist: ChecklistItemResponse[];
  /** Até 5, da mais recente para a mais antiga (RN04). */
  @ApiProperty({ type: [ActivityResponse] }) recentActivity: ActivityResponse[];

  static from({ view }: { view: DashboardView }): DashboardResponse {
    return {
      ...view,
      site: { ...view.site, publishedAt: view.site.publishedAt?.toISOString() ?? null },
      recentActivity: view.recentActivity.map((row) => ({
        ...row,
        readAt: row.readAt?.toISOString() ?? null,
        at: row.at.toISOString(),
      })),
    };
  }
}
