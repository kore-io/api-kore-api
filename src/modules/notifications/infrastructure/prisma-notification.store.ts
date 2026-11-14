import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import {
  CENTER_NOTIFICATION_TYPES,
  type CenterNotificationType,
  NOTIFICATION_TYPES,
  PLANNER_CENTER_TYPES,
  PLANNER_NOTIFICATION_TYPES,
  type EmailFrequency,
  type NotificationRow,
  type NotificationStore,
  type NotificationType,
  type PlannerNotificationType,
  type PreferenceRow,
} from '../application/ports/notification-store.port';

const PREFERENCE_SELECT = { type: true, inApp: true, email: true, push: true } as const;
/** A central do casal mostra só os tipos dela (Central RN01). */
const COUPLE_TYPES = { in: [...NOTIFICATION_TYPES] };
const PLANNER_TYPES = { in: [...PLANNER_NOTIFICATION_TYPES] };
/** A lista e o "marcar todas" da central do indicador. */
const PLANNER_CENTER = { in: [...PLANNER_CENTER_TYPES] };

const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  weddingId: true,
  count: true,
  payload: true,
  readAt: true,
  updatedAt: true,
} as const;

type Row = Prisma.NotificationGetPayload<{ select: typeof NOTIFICATION_SELECT }>;

function isPlannerType(type: string): type is PlannerNotificationType {
  return (PLANNER_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

function isCenterType(type: string): type is CenterNotificationType {
  return (CENTER_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

/** Do casal (rsvp e billing): os nomes vêm dos noivos do casamento, que a pessoa dona vê. */
const NAMES_FROM_WEDDING: readonly string[] = ['rsvp', 'billing'];

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? '';

/** O cursor da página: mais novas primeiro, pelo `updatedAt` e o id. */
function afterCursor(after: { updatedAt: Date; id: string } | null): Prisma.NotificationWhereInput {
  return after
    ? {
        OR: [
          { updatedAt: { lt: after.updatedAt } },
          { updatedAt: after.updatedAt, id: { lt: after.id } },
        ],
      }
    : {};
}

/** Na transação da requisição, com a RLS ligada. */
@Injectable()
export class PrismaNotificationStore implements NotificationStore {
  constructor(private readonly tenant: TenantTransaction) {}

  /**
   * Os nomes do casal de cada linha. Nos tipos novos, vêm do payload (ela pode
   * não ter mais vínculo, e a RLS de partners esconderia os noivos); no rsvp,
   * dos noivos do casamento, que ela ainda vê.
   */
  private async toRows(rows: Row[]): Promise<NotificationRow[]> {
    const rsvpWeddings = [
      ...new Set(
        rows.filter((row) => NAMES_FROM_WEDDING.includes(row.type)).map((row) => row.weddingId),
      ),
    ];
    const partners = rsvpWeddings.length
      ? await this.tenant.client().partner.findMany({
          where: { weddingId: { in: rsvpWeddings } },
          select: { weddingId: true, slot: true, displayName: true },
        })
      : [];
    const namesOf = (weddingId: string): [string, string] => {
      const name = (slot: number) =>
        firstName(
          partners.find((partner) => partner.weddingId === weddingId && partner.slot === slot)
            ?.displayName ?? '',
        );
      return [name(1), name(2)];
    };
    return rows.flatMap((row) => {
      if (!isCenterType(row.type)) return [];
      const fromPayload = Array.isArray(row.payload)
        ? (row.payload[0] as { partnerNames?: unknown } | undefined)?.partnerNames
        : undefined;
      const partnerNames =
        !NAMES_FROM_WEDDING.includes(row.type) &&
        Array.isArray(fromPayload) &&
        fromPayload.length === 2
          ? (fromPayload as [string, string])
          : namesOf(row.weddingId);
      return [{ ...row, type: row.type, partnerNames }];
    });
  }

  /** Os casamentos de que ela é dona: ficam na central do casal (RN05). */
  private async ownedWeddingIds({ userId }: { userId: string }): Promise<string[]> {
    const owned = await this.tenant.client().membership.findMany({
      where: { userId, role: 'owner', removedAt: null },
      select: { weddingId: true },
    });
    return owned.map(({ weddingId }) => weddingId);
  }

  private async plannerWhere({
    userId,
  }: {
    userId: string;
  }): Promise<Prisma.NotificationWhereInput> {
    return {
      userId,
      type: PLANNER_CENTER,
      weddingId: { notIn: await this.ownedWeddingIds({ userId }) },
    };
  }

  async list({
    userId,
    weddingId,
    type,
    after,
    limit,
  }: {
    userId: string;
    weddingId: string;
    type: NotificationType | null;
    after: { updatedAt: Date; id: string } | null;
    limit: number;
  }): Promise<NotificationRow[]> {
    const rows = await this.tenant.client().notification.findMany({
      where: { userId, weddingId, type: type ?? COUPLE_TYPES, ...afterCursor(after) },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: NOTIFICATION_SELECT,
    });
    return this.toRows(rows);
  }

  unreadCount({ userId, weddingId }: { userId: string; weddingId: string }): Promise<number> {
    return this.tenant.client().notification.count({
      where: { userId, weddingId, type: COUPLE_TYPES, readAt: null },
    });
  }

  async markRead({ userId, id, now }: { userId: string; id: string; now: Date }): Promise<boolean> {
    const tx = this.tenant.client();
    const found = await tx.notification.findFirst({ where: { id, userId }, select: { id: true } });
    if (!found) return false;
    await tx.notification.updateMany({ where: { id, readAt: null }, data: { readAt: now } });
    return true;
  }

  async markAllRead({
    userId,
    weddingId,
    now,
  }: {
    userId: string;
    weddingId: string;
    now: Date;
  }): Promise<void> {
    await this.tenant.client().notification.updateMany({
      where: { userId, weddingId, type: COUPLE_TYPES, readAt: null },
      data: { readAt: now },
    });
  }

  async preferences({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<PreferenceRow[]> {
    const rows = await this.tenant.client().notificationPreference.findMany({
      where: { userId, weddingId, type: COUPLE_TYPES },
      select: PREFERENCE_SELECT,
    });
    return rows.flatMap((row) => (isCenterType(row.type) ? [{ ...row, type: row.type }] : []));
  }

  async saveEmailPreference({
    userId,
    weddingId,
    type,
    email,
  }: {
    userId: string;
    weddingId: string;
    type: NotificationType;
    email: EmailFrequency;
  }): Promise<PreferenceRow> {
    const row = await this.tenant.client().notificationPreference.upsert({
      where: { userId_weddingId_type: { userId, weddingId, type } },
      create: { userId, weddingId, type, email },
      update: { email },
      select: PREFERENCE_SELECT,
    });
    return { ...row, type };
  }

  async hasPushSubscription({ sessionId }: { sessionId: string }): Promise<boolean> {
    return (await this.tenant.client().pushSubscription.count({ where: { sessionId } })) > 0;
  }

  async listPlanner({
    userId,
    type,
    after,
    limit,
  }: {
    userId: string;
    type: PlannerNotificationType | null;
    after: { updatedAt: Date; id: string } | null;
    limit: number;
  }): Promise<NotificationRow[]> {
    const where = await this.plannerWhere({ userId });
    const rows = await this.tenant.client().notification.findMany({
      where: { ...where, ...(type ? { type } : {}), ...afterCursor(after) },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: NOTIFICATION_SELECT,
    });
    return this.toRows(rows);
  }

  async unreadCountPlanner({ userId }: { userId: string }): Promise<number> {
    return this.tenant.client().notification.count({
      where: { ...(await this.plannerWhere({ userId })), readAt: null },
    });
  }

  async markAllReadPlanner({ userId, now }: { userId: string; now: Date }): Promise<void> {
    await this.tenant.client().notification.updateMany({
      where: { ...(await this.plannerWhere({ userId })), readAt: null },
      data: { readAt: now },
    });
  }

  async generalPreferences({ userId }: { userId: string }): Promise<PreferenceRow[]> {
    const rows = await this.tenant.client().notificationPreference.findMany({
      where: { userId, weddingId: null, type: PLANNER_TYPES },
      select: PREFERENCE_SELECT,
    });
    return rows.flatMap((row) => (isPlannerType(row.type) ? [{ ...row, type: row.type }] : []));
  }

  async saveGeneralEmailPreference({
    userId,
    type,
    email,
  }: {
    userId: string;
    type: PlannerNotificationType;
    email: EmailFrequency;
  }): Promise<PreferenceRow> {
    const tx = this.tenant.client();
    // O índice único da linha geral é parcial (weddingId nulo): o upsert do
    // Prisma não o usa. Com dois pedidos juntos, o segundo bate no índice.
    const found = await tx.notificationPreference.findFirst({
      where: { userId, weddingId: null, type },
      select: { id: true },
    });
    const row = found
      ? await tx.notificationPreference.update({
          where: { id: found.id },
          data: { email },
          select: PREFERENCE_SELECT,
        })
      : await tx.notificationPreference.create({
          data: { userId, weddingId: null, type, email },
          select: PREFERENCE_SELECT,
        });
    return { ...row, type };
  }
}
