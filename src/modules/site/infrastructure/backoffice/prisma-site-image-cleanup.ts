import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../../../shared/storage/application/object-storage.port';
import type {
  SiteImageCleanup,
  SiteImageCleanupCounts,
} from '../../application/ports/site-image-cleanup.port';
import {
  SITE_IMAGE_STALE_UPLOAD_MS,
  SITE_IMAGE_UNUSED_MS,
  siteImageKeys,
} from '../../domain/site-image';

/** As condições da RN08: o que passou do prazo, pelo relógio de `now`. */
function dueWhere({ now }: { now: Date }): Prisma.SiteImageWhereInput {
  return {
    // Casamento bloqueado RN06: a limpeza para enquanto o bloqueio durar.
    wedding: { blockedAt: null },
    OR: [
      // `updatedAt`: a confirmação que devolve a imagem a `uploading` dá mais 1 hora.
      {
        status: { in: ['uploading', 'processing'] },
        updatedAt: { lt: new Date(now.getTime() - SITE_IMAGE_STALE_UPLOAD_MS) },
      },
      { status: 'failed' },
      { status: 'ready', unusedSince: { lt: new Date(now.getTime() - SITE_IMAGE_UNUSED_MS) } },
    ],
  };
}

/**
 * Pela conexão do backoffice (sem RLS). Os arquivos saem dentro da transação,
 * com o casamento travado: se o armazenamento falhar, o erro desfaz tudo e a
 * rodada seguinte tenta de novo; se o commit falhar depois, as linhas voltam
 * sem arquivo e a rodada seguinte as apaga.
 */
@Injectable()
export class PrismaSiteImageCleanup implements SiteImageCleanup {
  constructor(
    private readonly prisma: BackofficePrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async weddingsWithCandidates({ now }: { now: Date }): Promise<string[]> {
    const rows = await this.prisma.siteImage.findMany({
      where: dueWhere({ now }),
      distinct: ['weddingId'],
      select: { weddingId: true },
    });
    return rows.map((row) => row.weddingId);
  }

  cleanWedding({
    weddingId,
    now,
  }: {
    weddingId: string;
    now: Date;
  }): Promise<SiteImageCleanupCounts> {
    return this.prisma.$transaction(async (tx) => {
      // O mesmo lock do limite e do recálculo do "em uso" (S4 RN07 e RN08): uma
      // imagem que volta a ser usada agora não é apagada.
      await tx.$queryRaw`SELECT id FROM weddings WHERE id = ${weddingId}::uuid FOR UPDATE`;
      const images = await tx.siteImage.findMany({
        where: { weddingId, ...dueWhere({ now }) },
        select: { id: true, status: true, keyToken: true },
      });
      const counts: SiteImageCleanupCounts = { stale: 0, failed: 0, unused: 0 };
      if (images.length === 0) return counts;
      await tx.siteImage.deleteMany({ where: { id: { in: images.map((image) => image.id) } } });
      for (const image of images) {
        if (image.status === 'failed') counts.failed += 1;
        else if (image.status === 'ready') counts.unused += 1;
        else counts.stale += 1;
      }
      const keys = images.map((image) => siteImageKeys({ keyToken: image.keyToken }));
      await this.storage.delete({ bucket: 'private', keys: keys.map((key) => key.original) });
      await this.storage.delete({
        bucket: 'public',
        keys: keys.flatMap((key) => [key.display, key.thumb, key.og]),
      });
      return counts;
    });
  }
}
