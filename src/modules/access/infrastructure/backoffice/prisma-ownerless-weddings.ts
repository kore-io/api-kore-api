import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../../../shared/storage/application/object-storage.port';
import { deleteSiteImageObjects, purgeWeddingData } from './wedding-purge';
import type {
  OwnerlessWedding,
  OwnerlessWeddings,
} from '../../application/ports/ownerless-weddings.port';

export const PURGE_NOTICE_SENT_ACTION = 'wedding.purge_notice_sent';
export const OWNERLESS_PURGED_ACTION = 'wedding.purged';
export const PURGE_NOTICE_FAILED_ACTION = 'wedding.purge_notice_failed';

const OWNERLESS_STATUSES = ['awaiting_couple', 'draft'] as const;
const NO_ACTIVE_OWNER: Prisma.WeddingWhereInput = {
  memberships: { none: { role: 'owner', removedAt: null } },
};

/** Pela conexão do backoffice (BYPASSRLS): a rotina atravessa os casamentos. */
@Injectable()
export class PrismaOwnerlessWeddings implements OwnerlessWeddings {
  constructor(
    private readonly prisma: BackofficePrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async listCandidates({
    lastActivityBefore,
  }: {
    lastActivityBefore: Date;
  }): Promise<OwnerlessWedding[]> {
    const weddings = await this.prisma.wedding.findMany({
      where: {
        status: { in: [...OWNERLESS_STATUSES] },
        lastActivityAt: { lte: lastActivityBefore },
        ...NO_ACTIVE_OWNER,
      },
      orderBy: { lastActivityAt: 'asc' },
      select: {
        id: true,
        status: true,
        lastActivityAt: true,
        purgeNoticeSentAt: true,
        createdBy: { select: { email: true, name: true } },
        partners: { select: { slot: true, displayName: true }, orderBy: { slot: 'asc' } },
      },
    });
    return weddings.map((wedding) => {
      const name = (slot: number) =>
        (wedding.partners.find((partner) => partner.slot === slot)?.displayName ?? '')
          .trim()
          .split(/\s+/)[0] ?? '';
      return {
        weddingId: wedding.id,
        status: wedding.status as OwnerlessWedding['status'],
        lastActivityAt: wedding.lastActivityAt,
        noticeSentAt: wedding.purgeNoticeSentAt,
        creator: wedding.createdBy,
        partnerNames: [name(1), name(2)],
      };
    });
  }

  markNoticeSent({
    weddingId,
    seenLastActivityAt,
    now,
  }: {
    weddingId: string;
    seenLastActivityAt: Date;
    now: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.wedding.updateMany({
        where: {
          id: weddingId,
          status: { in: [...OWNERLESS_STATUSES] },
          lastActivityAt: seenLastActivityAt,
          purgeNoticeSentAt: null,
          ...NO_ACTIVE_OWNER,
        },
        data: { purgeNoticeSentAt: now },
      });
      if (count !== 1) return false;
      await tx.applicationLog.create({
        data: {
          action: PURGE_NOTICE_SENT_ACTION,
          actorKind: 'system',
          weddingId,
          entityType: 'wedding',
          entityId: weddingId,
        },
      });
      return true;
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
        where: { id: weddingId, purgeNoticeSentAt: noticeSentAt },
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
        },
      });
      return true;
    });
  }

  purge({
    weddingId,
    seenLastActivityAt,
    now,
  }: {
    weddingId: string;
    seenLastActivityAt: Date;
    now: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM weddings WHERE id = ${weddingId}::uuid FOR UPDATE`;
      const wedding = await tx.wedding.findFirst({
        where: {
          id: weddingId,
          status: { in: [...OWNERLESS_STATUSES] },
          lastActivityAt: seenLastActivityAt,
          purgeNoticeSentAt: { not: null },
          ...NO_ACTIVE_OWNER,
        },
        select: { status: true },
      });
      if (!wedding) return false;
      const imageKeyTokens = await purgeWeddingData({ tx, weddingId, now });
      // Os arquivos saem dentro da transação, com o casamento travado: se o
      // armazenamento falhar, o erro desfaz o expurgo inteiro e a rotina tenta
      // de novo no dia seguinte (Imagens do site RN11).
      await deleteSiteImageObjects({ storage: this.storage, imageKeyTokens });
      await tx.applicationLog.create({
        data: {
          action: OWNERLESS_PURGED_ACTION,
          actorKind: 'system',
          weddingId,
          entityType: 'wedding',
          entityId: weddingId,
          data: { reason: 'ownerless_inactive', status: wedding.status },
        },
      });
      return true;
    });
  }
}
