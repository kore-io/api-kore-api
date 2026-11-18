import { Injectable } from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import type { AwaitingCoupleWeddings } from '@/modules/access/application/ports/awaiting-couple-weddings.port';

/** Pela conexão do backoffice (BYPASSRLS): a rotina atravessa os casamentos. */
@Injectable()
export class PrismaAwaitingCoupleWeddings implements AwaitingCoupleWeddings {
  constructor(private readonly prisma: BackofficePrismaService) {}

  async listWithoutPendingInvitation({
    now,
    weddingId,
  }: {
    now: Date;
    weddingId?: string;
  }): Promise<string[]> {
    const only = weddingId ? Prisma.sql`AND w.id = ${weddingId}::uuid` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT w.id::text AS id FROM weddings w
      WHERE w.status = 'awaiting_couple' ${only}
        AND NOT EXISTS (
          SELECT 1 FROM access_invitations i
          WHERE i.wedding_id = w.id AND i.role = 'owner'
            AND i.accepted_at IS NULL AND i.declined_at IS NULL
            AND i.revoked_at IS NULL AND i.superseded_at IS NULL
            AND i.expires_at > ${now}::timestamptz)
      ORDER BY w.id`;
    return rows.map(({ id }) => id);
  }

  async revert({ weddingId, now }: { weddingId: string; now: Date }): Promise<boolean> {
    // A função confere de novo, com a trava do casamento (um convite novo
    // pode ter chegado entre a lista e aqui).
    const [row] = await this.prisma.$queryRaw<[{ reverted: boolean }]>`
      SELECT revert_awaiting_couple(${weddingId}::uuid, 'expired', ${now}::timestamptz) AS reverted`;
    return row.reverted;
  }
}
