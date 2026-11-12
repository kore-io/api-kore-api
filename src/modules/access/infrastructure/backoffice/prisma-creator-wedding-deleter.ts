import { Inject, Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../../../shared/storage/application/object-storage.port';
import type {
  CreatorWeddingDeleter,
  CreatorWeddingDeletion,
} from '../../application/ports/creator-wedding-deletion.port';
import { deleteSiteImageObjects, purgeWeddingData } from './wedding-purge';

export const DELETED_BY_CREATOR_ACTION = 'wedding.deleted_by_creator';
const DELETABLE_STATUSES = ['draft', 'awaiting_couple'];

/** Pela conexão do backoffice (BYPASSRLS), numa transação com o casamento travado. */
@Injectable()
export class PrismaCreatorWeddingDeleter implements CreatorWeddingDeleter {
  constructor(
    private readonly prisma: BackofficePrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  deleteByCreator({
    weddingId,
    userId,
    now,
  }: {
    weddingId: string;
    userId: string;
    now: Date;
  }): Promise<CreatorWeddingDeletion> {
    return this.prisma.$transaction(async (tx): Promise<CreatorWeddingDeletion> => {
      // A mesma trava da accept_access_invitation: o aceite que chegou antes já
      // gravou o dono; o que chegar depois não acha mais o convite.
      await tx.$queryRaw`SELECT id FROM weddings WHERE id = ${weddingId}::uuid FOR UPDATE`;
      const wedding = await tx.wedding.findUnique({
        where: { id: weddingId },
        select: {
          status: true,
          createdByUserId: true,
          referralSource: true,
          _count: { select: { memberships: { where: { role: 'owner', removedAt: null } } } },
        },
      });
      if (
        !wedding ||
        wedding.createdByUserId !== userId ||
        wedding.referralSource !== 'created_by_planner'
      )
        return { result: 'not_allowed' };
      if (wedding._count.memberships > 0) return { result: 'has_owner' };
      if (!DELETABLE_STATUSES.includes(wedding.status)) return { result: 'not_allowed' };

      // Os convites pendentes saem com o resto: o link para de funcionar.
      const imageKeyTokens = await purgeWeddingData({ tx, weddingId, now });
      await tx.applicationLog.create({
        data: {
          action: DELETED_BY_CREATOR_ACTION,
          actorKind: 'user',
          actorUserId: userId,
          weddingId,
          entityType: 'wedding',
          entityId: weddingId,
          data: { status: wedding.status },
        },
      });
      return { result: 'deleted', status: wedding.status, imageKeyTokens };
    });
  }

  deleteImageObjects({ imageKeyTokens }: { imageKeyTokens: readonly string[] }): Promise<void> {
    return deleteSiteImageObjects({ storage: this.storage, imageKeyTokens });
  }
}
