import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  checklist,
  daysUntilEvent,
  partiesTotal,
  type ChecklistItem,
  type DeliveryCounts,
  type ReminderQueue,
} from '../domain/dashboard';
import {
  DASHBOARD_READER,
  type ActivityRow,
  type DashboardReader,
  type DashboardStats,
} from './ports/dashboard-reader.port';

export interface DashboardView {
  role: 'owner' | 'collaborator';
  stats: DashboardStats & { partiesTotal: number };
  delivery: DeliveryCounts;
  reminderQueue: ReminderQueue;
  site: { status: string; slug: string | null; publishedAt: Date | null; endDate: string | null };
  rsvpDeadline: string | null;
  eventDate: string | null;
  /** No fuso do casamento (RN01); nulo sem data. */
  daysUntilEvent: number | null;
  checklist: ChecklistItem[];
  recentActivity: ActivityRow[];
}

/**
 * GET …/dashboard (Dashboard RN01 a RN08): qualquer vínculo. Os números vêm
 * do WeddingStats na hora (sem cache), os envios de uma consulta agrupada, e a
 * Atividade recente das notificações do dono ou, para a colaboradora até a F6,
 * das últimas gravações do grupo (sem nome de convidado nem restrição).
 */
@Injectable()
export class GetDashboard {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(DASHBOARD_READER) private readonly reader: DashboardReader,
  ) {}

  async execute({
    userId,
    weddingId,
    now,
  }: {
    userId: string;
    weddingId: string;
    now: Date;
  }): Promise<DashboardView> {
    const role = await this.authorization.require({ userId, weddingId, action: 'view' });
    const wedding = await this.reader.wedding({ weddingId });
    if (!wedding) throw new Error('Casamento sem leitura na transação do vínculo.');
    const [stats, delivery, reminderQueue] = [
      await this.reader.stats({ weddingId }),
      await this.reader.delivery({ weddingId }),
      await this.reader.reminderQueue({ weddingId }),
    ];
    return {
      role,
      stats: { ...stats, partiesTotal: partiesTotal({ delivery }) },
      delivery,
      reminderQueue,
      site: {
        status: wedding.status,
        slug: wedding.slug,
        publishedAt: wedding.publishedAt,
        endDate: wedding.endDate,
      },
      rsvpDeadline: wedding.rsvpDeadline,
      eventDate: wedding.eventDate,
      daysUntilEvent: daysUntilEvent({ ...wedding, now }),
      checklist: checklist({
        delivery,
        reminderQueue,
        appearanceSet: wedding.appearanceSetAt !== null,
        published: wedding.publishedAt !== null,
      }),
      recentActivity:
        role === 'owner'
          ? await this.reader.notifications({ userId, weddingId })
          : await this.reader.partySubmissions({ weddingId }),
    };
  }
}
