import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { uuidV7 } from '@/shared/kernel/ids/uuid-v7';
import type { WeddingLifecycle } from '@/modules/access/application/ports/profile-directory.port';
import type { SupportSessionStore } from '@/modules/access/application/ports/support-session.store.port';
import {
  WEDDING_LIFECYCLE_SELECT,
  weddingLifecycle,
} from '@/modules/access/infrastructure/persistence/wedding-lifecycle';
import type {
  SupportEndReason,
  SupportSessionRecord,
} from '@/modules/access/domain/sessions/support-session';

const SELECT = {
  id: true,
  adminUserId: true,
  weddingId: true,
  startedAt: true,
  lastSeenAt: true,
  endedAt: true,
} as const;

const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

/** Pela conexão do backoffice: a support_sessions é só dele (G3). */
@Injectable()
export class PrismaSupportSessionStore implements SupportSessionStore {
  constructor(private readonly db: BackofficePrismaService) {}

  find({ id }: { id: string }): Promise<SupportSessionRecord | null> {
    return this.db.supportSession.findUnique({ where: { id }, select: SELECT });
  }

  async hasActiveOwner({ weddingId }: { weddingId: string }): Promise<boolean | null> {
    const wedding = await this.db.wedding.findUnique({
      where: { id: weddingId },
      select: {
        status: true,
        _count: { select: { memberships: { where: { role: 'owner', removedAt: null } } } },
      },
    });
    if (!wedding || wedding.status === 'purged') return null;
    return wedding._count.memberships > 0;
  }

  start({
    sessionId,
    adminUserId,
    weddingId,
    reason,
    now,
  }: {
    sessionId: string;
    adminUserId: string;
    weddingId: string;
    reason: string;
    now: Date;
  }): Promise<SupportSessionRecord> {
    return this.db.$transaction(async (tx) => {
      const current = await tx.session.findUniqueOrThrow({
        where: { id: sessionId },
        select: { supportSessionId: true },
      });
      if (current.supportSessionId)
        await this.close({ tx, id: current.supportSessionId, reason: 'exit', now });
      const created = await tx.supportSession.create({
        data: {
          id: uuidV7({ now: now.getTime() }),
          adminUserId,
          weddingId,
          reason,
          startedAt: now,
          lastSeenAt: now,
        },
        select: SELECT,
      });
      await tx.session.update({ where: { id: sessionId }, data: { supportSessionId: created.id } });
      await tx.applicationLog.create({
        data: {
          createdAt: now,
          action: 'support_session.started',
          actorKind: 'admin',
          actorUserId: adminUserId,
          weddingId,
          supportSessionId: created.id,
          entityType: 'support_session',
          entityId: created.id,
          data: { reason },
        },
      });
      return created;
    });
  }

  end({ id, reason, now }: { id: string; reason: SupportEndReason; now: Date }): Promise<boolean> {
    return this.db.$transaction((tx) => this.close({ tx, id, reason, now }));
  }

  async endForSession({ sessionId, now }: { sessionId: string; now: Date }): Promise<void> {
    const session = await this.db.session.findUnique({
      where: { id: sessionId },
      select: { supportSessionId: true },
    });
    if (session?.supportSessionId)
      await this.end({ id: session.supportSessionId, reason: 'logout', now });
  }

  async touch({
    id,
    adminUserId,
    weddingId,
    method,
    route,
    now,
  }: {
    id: string;
    adminUserId: string;
    weddingId: string;
    method: string;
    route: string;
    now: Date;
  }): Promise<void> {
    await this.db.$transaction([
      this.db.supportSession.updateMany({
        where: { id, endedAt: null },
        data: { lastSeenAt: now },
      }),
      // Uma linha por requisição, com o molde da rota e sem conteúdo (B9-5).
      this.db.applicationLog.create({
        data: {
          createdAt: now,
          action: 'support_session.request',
          actorKind: 'admin',
          actorUserId: adminUserId,
          weddingId,
          supportSessionId: id,
          data: { method, route },
        },
      }),
    ]);
  }

  async staffRoleOf({ userId }: { userId: string }): Promise<'admin' | 'support' | null> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { platformRole: true, status: true },
    });
    if (!user || user.status !== 'active' || user.platformRole === 'none') return null;
    return user.platformRole;
  }

  async coupleWedding({
    weddingId,
  }: {
    weddingId: string;
  }): Promise<{ partnerNames: [string, string]; lifecycle: WeddingLifecycle } | null> {
    const wedding = await this.db.wedding.findUnique({
      where: { id: weddingId },
      select: {
        ...WEDDING_LIFECYCLE_SELECT,
        partners: { orderBy: { slot: 'asc' }, select: { slot: true, displayName: true } },
      },
    });
    if (!wedding) return null;
    const name = (slot: number) =>
      firstName(wedding.partners.find((partner) => partner.slot === slot)?.displayName);
    return { partnerNames: [name(1), name(2)], lifecycle: weddingLifecycle({ wedding }) };
  }

  private async close({
    tx,
    id,
    reason,
    now,
  }: {
    tx: Parameters<Parameters<BackofficePrismaService['$transaction']>[0]>[0];
    id: string;
    reason: SupportEndReason;
    now: Date;
  }): Promise<boolean> {
    const session = await tx.supportSession.findUnique({ where: { id }, select: SELECT });
    if (!session || session.endedAt) return false;
    await tx.supportSession.update({ where: { id }, data: { endedAt: now, endReason: reason } });
    await tx.session.updateMany({
      where: { supportSessionId: id },
      data: { supportSessionId: null },
    });
    await tx.applicationLog.create({
      data: {
        createdAt: now,
        action: 'support_session.ended',
        actorKind: 'admin',
        actorUserId: session.adminUserId,
        weddingId: session.weddingId,
        supportSessionId: id,
        entityType: 'support_session',
        entityId: id,
        data: { endReason: reason },
      },
    });
    return true;
  }
}
