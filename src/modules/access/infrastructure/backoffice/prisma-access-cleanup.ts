import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type { AccessCleanup } from '../../application/ports/access-cleanup.port';

const DELETE_BATCH_SIZE = 5_000;

/** Roda com a conexão do backoffice e apaga em lotes, sem locks longos. */
@Injectable()
export class PrismaAccessCleanup implements AccessCleanup {
  constructor(private readonly prisma: BackofficePrismaService) {}

  deleteEndedSessions({ now }: { now: Date }): Promise<number> {
    return this.inBatches(
      () => this.prisma.$executeRaw`
        DELETE FROM sessions WHERE id IN (
          SELECT id FROM sessions
          WHERE expires_at <= ${now} OR revoked_at IS NOT NULL
          LIMIT ${DELETE_BATCH_SIZE}
        )`,
    );
  }

  deleteLoginChallengesCreatedBefore({ createdBefore }: { createdBefore: Date }): Promise<number> {
    return this.inBatches(
      () => this.prisma.$executeRaw`
        DELETE FROM login_challenges WHERE id IN (
          SELECT id FROM login_challenges
          WHERE created_at < ${createdBefore}
          LIMIT ${DELETE_BATCH_SIZE}
        )`,
    );
  }

  private async inBatches(deleteBatch: () => Promise<number>): Promise<number> {
    let total = 0;
    for (;;) {
      const deleted = await deleteBatch();
      total += deleted;
      if (deleted < DELETE_BATCH_SIZE) return total;
    }
  }
}
