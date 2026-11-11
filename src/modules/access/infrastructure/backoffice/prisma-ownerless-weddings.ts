import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../../../shared/storage/application/object-storage.port';
import { siteImageKeys } from '../../../site/domain/site-image';
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
      await tx.accessInvitation.deleteMany({ where: { weddingId } });
      await tx.membership.deleteMany({ where: { weddingId } });
      await tx.partner.deleteMany({ where: { weddingId } });
      // A lápide fica, então o cascade do Wedding não dispara: as filhas da F1 saem
      // à mão, das folhas para a raiz (decisão 207(17)).
      await tx.guestTag.deleteMany({ where: { weddingId } });
      await tx.partyTag.deleteMany({ where: { weddingId } });
      await tx.guest.deleteMany({ where: { weddingId } });
      await tx.party.deleteMany({ where: { weddingId } });
      await tx.tag.deleteMany({ where: { weddingId } });
      await tx.weddingStats.deleteMany({ where: { weddingId } });
      await this.purgeSiteImages({ tx, weddingId });
      // Lápide (Modelo de Dados): ficam id, status, purgedAt, o indicador e createdAt.
      await tx.wedding.update({
        where: { id: weddingId },
        data: {
          status: 'purged',
          purgedAt: now,
          slug: null,
          eventDate: null,
          timezone: null,
          city: null,
          state: null,
          createdByUserId: null,
          signupSource: null,
          utmSource: null,
          utmMedium: null,
          utmCampaign: null,
          purgeNoticeSentAt: null,
        },
      });
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

  /**
   * As imagens do site e os arquivos delas (Imagens do site RN11), pela lista
   * do banco: as chaves não levam o casamento. Os objetos saem dentro da
   * transação, com o casamento travado. Se o armazenamento falhar, o erro
   * desfaz o expurgo inteiro no banco e a rotina tenta de novo no dia seguinte.
   * Se o commit falhar depois de apagar os arquivos, as linhas voltam sem
   * arquivo, o que é inofensivo: a rodada seguinte as apaga de novo.
   */
  private async purgeSiteImages({
    tx,
    weddingId,
  }: {
    tx: Prisma.TransactionClient;
    weddingId: string;
  }): Promise<void> {
    const images = await tx.siteImage.findMany({ where: { weddingId }, select: { id: true } });
    if (images.length === 0) return;
    await tx.siteImage.deleteMany({ where: { weddingId } });
    const keys = images.map(({ id }) => siteImageKeys({ imageId: id }));
    await this.storage.delete({ bucket: 'private', keys: keys.map((key) => key.original) });
    await this.storage.delete({
      bucket: 'public',
      keys: keys.flatMap((key) => [key.display, key.thumb, key.og]),
    });
  }
}
