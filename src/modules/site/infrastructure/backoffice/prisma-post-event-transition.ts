import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../../../shared/ids/uuid-v7';
import { DEFAULT_TIMEZONE } from '../../../../shared/time/local-date';
import type { PostEventTransition } from '../../application/ports/post-event-transition.port';

/** Pela conexão do backoffice (sem RLS): a rotina atravessa os casamentos. */
@Injectable()
export class PrismaPostEventTransition implements PostEventTransition {
  constructor(private readonly prisma: BackofficePrismaService) {}

  moveDue({ now }: { now: Date }): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      // Idempotente (revisão técnica R1-8): só o que ainda está publicado muda,
      // e o log sai só para as linhas devolvidas. "Hoje" é o do fuso de cada
      // casamento, não o do cron.
      const moved = await tx.$queryRaw<{ id: string }[]>`
        UPDATE weddings SET status = 'post_event', updated_at = ${now}
        WHERE status = 'published' AND event_date IS NOT NULL
          AND event_date < (${now}::timestamptz AT TIME ZONE coalesce(timezone, ${DEFAULT_TIMEZONE}))::date
        RETURNING id::text AS id`;
      if (moved.length > 0)
        await tx.applicationLog.createMany({
          data: moved.map(({ id }, index) => ({
            id: uuidV7({ now: now.getTime() + index }),
            createdAt: now,
            action: 'wedding.post_event',
            actorKind: 'system',
            weddingId: id,
            entityType: 'wedding',
            entityId: id,
          })),
        });
      return moved.map(({ id }) => id);
    });
  }
}
