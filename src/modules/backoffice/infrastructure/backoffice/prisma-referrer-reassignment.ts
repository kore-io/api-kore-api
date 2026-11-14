import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../../../shared/ids/uuid-v7';
import type {
  ReassignResult,
  ReferrerReassignment,
} from '../../application/ports/referrer-reassignment.port';

const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

/** Pela conexão do backoffice (decisão 180(5)). */
@Injectable()
export class PrismaReferrerReassignment implements ReferrerReassignment {
  constructor(private readonly db: BackofficePrismaService) {}

  reassign({
    weddingId,
    referrerId,
    byUserId,
    reason,
    now,
  }: {
    weddingId: string;
    referrerId: string | null;
    byUserId: string;
    reason: string;
    now: Date;
  }): Promise<ReassignResult> {
    return this.db.$transaction(async (tx): Promise<ReassignResult> => {
      // O Wedding primeiro (RN18), depois os pagamentos dele.
      const [wedding] = await tx.$queryRaw<{ referrerId: string | null }[]>`
        SELECT referrer_id::text AS "referrerId" FROM weddings
        WHERE id = ${weddingId}::uuid AND status <> 'purged' FOR UPDATE`;
      if (!wedding) return { result: 'not_found' };
      const payments = await tx.$queryRaw<{ kind: string; status: string; paidAt: Date | null }[]>`
        SELECT kind::text AS kind, status::text AS status, paid_at AS "paidAt"
        FROM payments WHERE wedding_id = ${weddingId}::uuid ORDER BY id FOR UPDATE`;
      // Depois da publicação paga, a comissão já nasceu com o indicador (invariante 12.1).
      const paid = payments
        .filter((payment) => payment.kind === 'publication' && payment.paidAt)
        .sort((a, b) => a.paidAt!.getTime() - b.paidAt!.getTime())[0];
      if (paid?.paidAt) return { result: 'already_paid', paidAt: paid.paidAt };
      // O desconto do pendente foi cotado com o indicador antigo (B9-8).
      if (payments.some((payment) => payment.status === 'pending'))
        return { result: 'payment_pending' };
      let newUserId: string | null = null;
      if (referrerId) {
        const referrer = await tx.referrer.findUnique({
          where: { id: referrerId },
          select: { status: true, userId: true },
        });
        if (!referrer || referrer.status !== 'active') return { result: 'referrer_not_active' };
        newUserId = referrer.userId;
      }
      if (wedding.referrerId === referrerId) return { result: 'unchanged' };
      const oldUserId = wedding.referrerId
        ? ((
            await tx.referrer.findUnique({
              where: { id: wedding.referrerId },
              select: { userId: true },
            })
          )?.userId ?? null)
        : null;

      await tx.wedding.update({
        where: { id: weddingId },
        // Sem indicador, a origem fica nula (CHECK chk_weddings_referral); o log guarda a troca.
        data: { referrerId, referralSource: referrerId ? 'admin_reassigned' : null },
      });
      await tx.applicationLog.create({
        data: {
          createdAt: now,
          action: 'wedding.referrer_reassigned',
          actorKind: 'admin',
          actorUserId: byUserId,
          weddingId,
          entityType: 'wedding',
          entityId: weddingId,
          data: { fromReferrerId: wedding.referrerId, toReferrerId: referrerId, reason },
        },
      });
      const partners = await tx.partner.findMany({
        where: { weddingId },
        orderBy: { slot: 'asc' },
        select: { displayName: true },
      });
      const partnerNames = [
        firstName(partners[0]?.displayName),
        firstName(partners[1]?.displayName),
      ];
      // Sem revelar ao antigo o nome do novo (decisão 80): só o casal e o sentido.
      const notices = [
        ...(oldUserId ? [{ userId: oldUserId, direction: 'lost' }] : []),
        ...(newUserId ? [{ userId: newUserId, direction: 'gained' }] : []),
      ];
      if (notices.length > 0)
        await tx.notification.createMany({
          data: notices.map(({ userId, direction }) => ({
            id: uuidV7({ now: now.getTime() }),
            userId,
            weddingId,
            type: 'referrer_reassigned' as const,
            groupKey: `referrer_reassigned:${weddingId}:${now.toISOString()}:${direction}`,
            count: 1,
            payload: [{ partnerNames, direction }] as Prisma.InputJsonValue,
            createdAt: now,
            updatedAt: now,
          })),
        });
      return { result: 'reassigned' };
    });
  }
}
