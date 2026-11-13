import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../../../shared/ids/uuid-v7';
import type {
  CommissionRelease,
  ReleasedCommission,
} from '../../application/ports/commission-release.port';

const firstName = (value: string | null | undefined): string =>
  (value ?? '').trim().split(/\s+/)[0] ?? '';

/** Pela conexão do backoffice (sem RLS): a rotina atravessa os indicadores. */
@Injectable()
export class PrismaCommissionRelease implements CommissionRelease {
  constructor(private readonly prisma: BackofficePrismaService) {}

  release({ now, referrerId }: { now: Date; referrerId?: string }): Promise<ReleasedCommission[]> {
    const only = referrerId ? Prisma.sql`AND c.referrer_id = ${referrerId}::uuid` : Prisma.empty;
    return this.prisma.$transaction(async (tx) => {
      // Idempotente: só o que ainda está pending muda; a notificação, só dessas.
      const released = await tx.$queryRaw<ReleasedCommission[]>`
        UPDATE commissions c
        SET status = 'available', updated_at = ${now}
        FROM referrers r
        WHERE r.id = c.referrer_id AND c.status = 'pending'
          AND (c.available_at AT TIME ZONE 'America/Sao_Paulo')::date
              <= (${now}::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
          ${only}
        RETURNING c.id::text AS id, r.user_id::text AS "referrerUserId",
                  c.wedding_id::text AS "weddingId", c.amount_cents AS "amountCents"`;
      if (released.length === 0) return released;
      const partners = await tx.partner.findMany({
        where: { weddingId: { in: [...new Set(released.map((row) => row.weddingId))] } },
        select: { weddingId: true, slot: true, displayName: true },
      });
      const namesOf = (weddingId: string): [string, string] => {
        const name = (slot: number) =>
          firstName(
            partners.find((p) => p.weddingId === weddingId && p.slot === slot)?.displayName,
          );
        return [name(1), name(2)];
      };
      // "R$ 67,42 de comissão de Ana e Marcos disponível para repasse" (RN09): o
      // app monta o texto; os nomes vão no payload (a lápide não os apaga daqui).
      await tx.notification.createMany({
        data: released.map((row, index) => ({
          id: uuidV7({ now: now.getTime() + index }),
          userId: row.referrerUserId,
          weddingId: row.weddingId,
          type: 'commission' as const,
          groupKey: `commission:${row.id}`,
          payload: [
            {
              commissionId: row.id,
              amountCents: row.amountCents,
              partnerNames: namesOf(row.weddingId),
              at: now.toISOString(),
            },
          ] as Prisma.InputJsonValue,
          createdAt: now,
          updatedAt: now,
        })),
        skipDuplicates: true,
      });
      return released;
    });
  }
}
