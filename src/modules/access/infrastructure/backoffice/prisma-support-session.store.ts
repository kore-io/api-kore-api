import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../../../shared/ids/uuid-v7';
import type { SupportSessionStore } from '../../application/ports/support-session.store.port';
import type { SupportEndReason, SupportSessionRecord } from '../../domain/support-session';

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

  async coupleNames({ weddingId }: { weddingId: string }): Promise<string> {
    const partners = await this.db.partner.findMany({
      where: { weddingId },
      orderBy: { slot: 'asc' },
      select: { displayName: true },
    });
    return partners.map((partner) => firstName(partner.displayName)).join(' & ');
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
