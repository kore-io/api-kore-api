import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../../../shared/storage/application/object-storage.port';
import { uuidV7 } from '../../../../shared/ids/uuid-v7';
import {
  deleteSiteImageObjects,
  purgeWeddingData,
} from '../../../access/infrastructure/backoffice/wedding-purge';
import { addDays } from '../../domain/pricing';
import { RETENTION_NOTICE_DAYS, type PurgeReason } from '../../domain/retention';
import type {
  RetentionCandidate,
  RetentionNoticeTarget,
  WeddingRetentionStore,
} from '../../application/ports/wedding-retention.port';

export const PURGE_NOTICE_SENT_ACTION = 'wedding.purge_notice_sent';
export const PURGE_NOTICE_FAILED_ACTION = 'wedding.purge_notice_failed';
export const WEDDING_PURGED_ACTION = 'wedding.purged';

const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

/** Pela conexão do backoffice (BYPASSRLS): a rotina atravessa os casamentos. */
@Injectable()
export class PrismaWeddingRetentionStore implements WeddingRetentionStore {
  constructor(
    private readonly prisma: BackofficePrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async listCandidates({
    now,
    weddingId,
  }: {
    now: Date;
    weddingId?: string;
  }): Promise<RetentionCandidate[]> {
    // Um dia de folga sobre o UTC cobre todos os fusos; o passo exato é do domínio.
    const utcToday = now.toISOString().slice(0, 10);
    const noticeFrom = new Date(
      `${addDays({ day: utcToday, days: RETENTION_NOTICE_DAYS + 1 })}T00:00:00Z`,
    );
    const deletionFrom = new Date(`${addDays({ day: utcToday, days: 1 })}T00:00:00Z`);
    const rows = await this.prisma.wedding.findMany({
      where: {
        ...(weddingId ? { id: weddingId } : {}),
        // Bloqueado: nem aviso, nem expurgo (decisão 86).
        blockedAt: null,
        status: { not: 'purged' },
        OR: [
          { status: 'expired', deletionScheduledFor: null, purgeAt: { lte: noticeFrom } },
          { deletionScheduledFor: { lte: deletionFrom } },
        ],
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        status: true,
        timezone: true,
        purgeAt: true,
        expiredAt: true,
        deletionScheduledFor: true,
        purgeNoticeSentAt: true,
        blockedAt: true,
      },
    });
    return rows.map((row) => ({
      weddingId: row.id,
      status: row.status,
      timezone: row.timezone,
      purgeAt: day(row.purgeAt),
      expiredAt: day(row.expiredAt),
      deletionScheduledFor: day(row.deletionScheduledFor),
      purgeNoticeSentAt: row.purgeNoticeSentAt,
      blocked: row.blockedAt !== null,
    }));
  }

  markNotice({
    weddingId,
    purgeAt,
    now,
  }: {
    weddingId: string;
    purgeAt: string;
    now: Date;
  }): Promise<RetentionNoticeTarget | null> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.wedding.updateMany({
        where: {
          id: weddingId,
          status: 'expired',
          purgeAt: new Date(`${purgeAt}T00:00:00Z`),
          purgeNoticeSentAt: null,
          blockedAt: null,
          deletionScheduledFor: null,
        },
        data: { purgeNoticeSentAt: now },
      });
      if (count !== 1) return null;
      await tx.applicationLog.create({
        data: {
          createdAt: now,
          action: PURGE_NOTICE_SENT_ACTION,
          actorKind: 'system',
          weddingId,
          entityType: 'wedding',
          entityId: weddingId,
          data: { reason: 'retention', purgeAt },
        },
      });
      const owners = await tx.membership.findMany({
        where: { weddingId, role: 'owner', removedAt: null, user: { status: 'active' } },
        orderBy: { createdAt: 'asc' },
        select: {
          userId: true,
          user: {
            select: {
              email: true,
              name: true,
              partners: { where: { weddingId }, select: { displayName: true } },
            },
          },
        },
      });
      const partners = await tx.partner.findMany({
        where: { weddingId },
        orderBy: { slot: 'asc' },
        select: { displayName: true },
      });
      // A central: "Os dados do casamento serão apagados em 22 de ago." (o app monta o texto).
      if (owners.length > 0)
        await tx.notification.createMany({
          data: owners.map(({ userId }) => ({
            id: uuidV7({ now: now.getTime() }),
            userId,
            weddingId,
            type: 'billing' as const,
            groupKey: `billing:purge_soon:${purgeAt}`,
            payload: [
              { kind: 'purge_soon', purgeAt, at: now.toISOString() },
            ] as Prisma.InputJsonValue,
            createdAt: now,
            updatedAt: now,
          })),
          skipDuplicates: true,
        });
      return {
        recipients: owners.map(({ userId, user }) => ({
          userId,
          email: user.email,
          firstName: firstName(user.partners[0]?.displayName ?? user.name),
        })),
        partnerNames: [firstName(partners[0]?.displayName), firstName(partners[1]?.displayName)],
      };
    });
  }

  clearNotice({
    weddingId,
    noticeSentAt,
  }: {
    weddingId: string;
    noticeSentAt: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.wedding.updateMany({
        where: { id: weddingId, status: 'expired', purgeNoticeSentAt: noticeSentAt },
        data: { purgeNoticeSentAt: null },
      });
      if (count !== 1) return false;
      await tx.applicationLog.create({
        data: {
          action: PURGE_NOTICE_FAILED_ACTION,
          actorKind: 'system',
          weddingId,
          entityType: 'wedding',
          entityId: weddingId,
          data: { reason: 'retention' },
        },
      });
      return true;
    });
  }

  purge({
    weddingId,
    reason,
    now,
  }: {
    weddingId: string;
    reason: PurgeReason;
    now: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        // A ordem única (Publicar e pagar RN18): o Wedding primeiro.
        const [wedding] = await tx.$queryRaw<
          {
            status: string;
            blocked: boolean;
            deletion: boolean;
            noticeSentAt: Date | null;
            requestedBy: string | null;
          }[]
        >`
          SELECT status::text AS status, blocked_at IS NOT NULL AS blocked,
                 deletion_scheduled_for IS NOT NULL AS deletion,
                 purge_notice_sent_at AS "noticeSentAt",
                 deletion_requested_by_user_id::text AS "requestedBy"
          FROM weddings WHERE id = ${weddingId}::uuid FOR UPDATE`;
        if (!wedding || wedding.status === 'purged' || wedding.blocked) return false;
        // Confere de novo o que a rotina leu: cancelou a exclusão, renovou ou
        // o aviso foi desfeito no meio do caminho, e o expurgo não acontece.
        if (reason === 'owner_request' && !wedding.deletion) return false;
        if (
          reason === 'retention' &&
          (wedding.deletion || wedding.status !== 'expired' || !wedding.noticeSentAt)
        )
          return false;

        // A cerimonialista colaboradora (com Planner) é avisada quando o
        // expurgo pedido pelo casal acontece (Retenção RN05): os nomes vêm antes da lápide.
        const removedPlanners =
          reason === 'owner_request' ? await this.plannerCollaborators({ tx, weddingId }) : [];
        const partnerNames =
          removedPlanners.length > 0 ? await this.partnerNames({ tx, weddingId }) : null;

        const imageKeyTokens = await purgeWeddingData({ tx, weddingId, now });
        // Os arquivos saem dentro da transação, com o casamento travado: se o
        // armazenamento falhar, o erro desfaz o expurgo e a rotina tenta de novo.
        await deleteSiteImageObjects({ storage: this.storage, imageKeyTokens });
        await tx.applicationLog.create({
          data: {
            createdAt: now,
            action: WEDDING_PURGED_ACTION,
            actorKind: 'system',
            weddingId,
            entityType: 'wedding',
            entityId: weddingId,
            data: {
              reason,
              status: wedding.status,
              ...(wedding.requestedBy ? { requestedByUserId: wedding.requestedBy } : {}),
            },
          },
        });
        if (partnerNames && removedPlanners.length > 0)
          await tx.notification.createMany({
            data: removedPlanners.map(({ userId, membershipId }) => ({
              id: uuidV7({ now: now.getTime() }),
              userId,
              weddingId,
              type: 'membership_removed' as const,
              groupKey: `membership_removed:${membershipId}`,
              count: 1,
              payload: [{ partnerNames }] as Prisma.InputJsonValue,
              createdAt: now,
              updatedAt: now,
            })),
            skipDuplicates: true,
          });
        return true;
      },
      { timeout: 30_000 },
    );
  }

  async openPurgeFailedAlert({
    weddingId,
    error,
  }: {
    weddingId: string;
    error: string;
  }): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO alerts (id, type, wedding_id, entity_type, entity_id, data)
      VALUES (${uuidV7()}::uuid, 'purge_failed'::alert_type, ${weddingId}::uuid, 'wedding',
              ${weddingId}, ${JSON.stringify({ error })}::jsonb)
      ON CONFLICT (type, entity_type, entity_id) WHERE status = 'open' DO NOTHING`;
  }

  private async plannerCollaborators({
    tx,
    weddingId,
  }: {
    tx: Prisma.TransactionClient;
    weddingId: string;
  }): Promise<{ userId: string; membershipId: string }[]> {
    const rows = await tx.membership.findMany({
      where: {
        weddingId,
        role: 'collaborator',
        removedAt: null,
        user: { referrer: { kind: 'planner', planner: { isNot: null } } },
      },
      select: { id: true, userId: true },
    });
    return rows.map((row) => ({ userId: row.userId, membershipId: row.id }));
  }

  private async partnerNames({
    tx,
    weddingId,
  }: {
    tx: Prisma.TransactionClient;
    weddingId: string;
  }): Promise<[string, string]> {
    const partners = await tx.partner.findMany({
      where: { weddingId },
      orderBy: { slot: 'asc' },
      select: { displayName: true },
    });
    return [firstName(partners[0]?.displayName), firstName(partners[1]?.displayName)];
  }
}
