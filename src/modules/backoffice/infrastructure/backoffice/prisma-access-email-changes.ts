import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../../../shared/ids/uuid-v7';
import type {
  AccessEmailChangeInput,
  AccessEmailChangeResult,
  AccessEmailChanges,
  UnlockResult,
} from '../../application/ports/access-email-changes.port';
import {
  FAILED_CHECKS_WINDOW_MS,
  REPEAT_CHANGE_WINDOW_MS,
  STAFF_DAILY_ATTEMPTS,
  UNLOCK_INTERVAL_MS,
  WEDDING_FAILED_CHECKS_LIMIT,
  brasiliaDay,
  maskEmail,
  normalizeLast4,
} from '../../domain/access-email-change';
import type { StaffMember } from '../../domain/staff';

export const ACCESS_EMAIL_CHANGED_ACTION = 'user.access_email_changed';
export const ACCESS_EMAIL_CHECKS_FAILED_ACTION = 'user.access_email_checks_failed';
export const ACCESS_EMAIL_UNLOCKED_ACTION = 'admin.access_email_unlocked';

type Tx = Prisma.TransactionClient;

/** Pela conexão do backoffice (decisão 180(5)). */
@Injectable()
export class PrismaAccessEmailChanges implements AccessEmailChanges {
  constructor(private readonly db: BackofficePrismaService) {}

  change(input: AccessEmailChangeInput): Promise<AccessEmailChangeResult> {
    const { staff, weddingId, userId, now } = input;
    return this.db.$transaction(async (tx): Promise<AccessEmailChangeResult> => {
      // Uma troca por atendente de cada vez, antes da trava do Wedding: a
      // contagem do dia não é furada por pedidos em paralelo (decisão 253(1)).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`access_email:${staff.userId}`}, 0))`;
      const [wedding] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM weddings
        WHERE id = ${weddingId}::uuid AND status <> 'purged' FOR UPDATE`;
      if (!wedding) return { result: 'not_found' };

      // 5 tentativas por atendente por dia de Brasília (o Admin sem limite).
      if (staff.role === 'support') {
        const day = brasiliaDay({ now });
        const attempts = await tx.applicationLog.count({
          where: {
            actorUserId: staff.userId,
            action: { in: [ACCESS_EMAIL_CHANGED_ACTION, ACCESS_EMAIL_CHECKS_FAILED_ACTION] },
            createdAt: { gte: day.start },
          },
        });
        if (attempts >= STAFF_DAILY_ATTEMPTS) return { result: 'rate_limited', retryAt: day.next };
      }

      // Só para donos ativos, nunca para alguém do staff (RN09).
      const owner = await tx.membership.findFirst({
        where: { weddingId, userId, role: 'owner', removedAt: null },
        select: {
          user: {
            select: { email: true, platformRole: true, status: true, accessEmailChangedAt: true },
          },
        },
      });
      if (!owner || owner.user.platformRole !== 'none' || owner.user.status !== 'active')
        return { result: 'not_allowed' };

      // 3 conferências erradas em 24 h travam o casamento (para qualquer papel).
      const failures = await this.recentFailures({ tx, weddingId, now });
      if (failures.length >= WEDDING_FAILED_CHECKS_LIMIT)
        return {
          result: 'locked',
          availableAt: new Date(failures[0].getTime() + FAILED_CHECKS_WINDOW_MS),
        };

      const repeat =
        owner.user.accessEmailChangedAt !== null &&
        now.getTime() - owner.user.accessEmailChangedAt.getTime() < REPEAT_CHANGE_WINDOW_MS;
      if (repeat && staff.role !== 'admin') return { result: 'admin_only' };

      // Os 4 dígitos de quem pagou, conferidos aqui; o staff nunca os vê.
      const payers = await tx.payment.findMany({
        where: { weddingId, paidAt: { not: null } },
        select: { payerTaxIdLast4: true },
      });
      if (payers.length > 0) {
        if (!input.payerLast4) return { result: 'checks_required' };
        const typed = normalizeLast4(input.payerLast4);
        if (!payers.some((payer) => payer.payerTaxIdLast4 === typed)) {
          await this.log({
            tx,
            staff,
            weddingId,
            userId,
            action: ACCESS_EMAIL_CHECKS_FAILED_ACTION,
            data: { role: staff.role },
            ipHash: input.ipHash,
            now,
          });
          if (failures.length + 1 >= WEDDING_FAILED_CHECKS_LIMIT)
            await this.openAlert({
              tx,
              type: 'access_email_locked',
              weddingId,
              entityType: 'wedding',
              entityId: weddingId,
              data: { failures: failures.length + 1 },
            });
          return { result: 'checks_failed' };
        }
      }

      const taken = await tx.user.findFirst({
        where: { email: { equals: input.newEmail, mode: 'insensitive' }, id: { not: userId } },
        select: { id: true },
      });
      if (taken) return { result: 'email_in_use' };

      const oldEmail = owner.user.email;
      await tx.user.update({
        where: { id: userId },
        data: { email: input.newEmail, accessEmailChangedAt: now },
      });
      // As sessões terminam e o Google antigo deixa de entrar (RN09).
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.authIdentity.deleteMany({ where: { userId } });
      await this.openAlert({
        tx,
        type: 'access_email_changed',
        weddingId,
        entityType: 'user',
        entityId: userId,
        data: { byRole: staff.role, repeatWithin7Days: repeat },
      });
      await this.log({
        tx,
        staff,
        weddingId,
        userId,
        action: ACCESS_EMAIL_CHANGED_ACTION,
        data: {
          role: staff.role,
          reason: input.reason,
          newEmailMasked: maskEmail(input.newEmail),
          repeatWithin7Days: repeat,
        },
        ipHash: input.ipHash,
        now,
      });
      return { result: 'changed', oldEmail, newEmail: input.newEmail };
    });
  }

  unlock({
    staff,
    weddingId,
    reason,
    ipHash,
    now,
  }: {
    staff: StaffMember;
    weddingId: string;
    reason: string;
    ipHash: string | null;
    now: Date;
  }): Promise<UnlockResult> {
    return this.db.$transaction(async (tx): Promise<UnlockResult> => {
      const [wedding] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM weddings
        WHERE id = ${weddingId}::uuid AND status <> 'purged' FOR UPDATE`;
      if (!wedding) return { result: 'not_found' };
      const lastUnlock = await this.lastUnlockAt({ tx, weddingId });
      if (lastUnlock && now.getTime() - lastUnlock.getTime() < UNLOCK_INTERVAL_MS)
        return {
          result: 'too_soon',
          availableAt: new Date(lastUnlock.getTime() + UNLOCK_INTERVAL_MS),
        };
      const failures = await this.recentFailures({ tx, weddingId, now });
      if (failures.length < WEDDING_FAILED_CHECKS_LIMIT) return { result: 'not_locked' };
      await this.log({
        tx,
        staff,
        weddingId,
        userId: null,
        action: ACCESS_EMAIL_UNLOCKED_ACTION,
        data: { reason },
        ipHash,
        now,
      });
      await this.openAlert({
        tx,
        type: 'access_email_unlocked',
        weddingId,
        entityType: 'wedding',
        entityId: weddingId,
        data: { byUserId: staff.userId },
      });
      return { result: 'unlocked' };
    });
  }

  /** As conferências erradas das últimas 24 h, depois da última liberação, da mais antiga. */
  private async recentFailures({
    tx,
    weddingId,
    now,
  }: {
    tx: Tx;
    weddingId: string;
    now: Date;
  }): Promise<Date[]> {
    const windowStart = new Date(now.getTime() - FAILED_CHECKS_WINDOW_MS);
    const lastUnlock = await this.lastUnlockAt({ tx, weddingId });
    const since = lastUnlock && lastUnlock > windowStart ? lastUnlock : windowStart;
    const rows = await tx.applicationLog.findMany({
      where: { weddingId, action: ACCESS_EMAIL_CHECKS_FAILED_ACTION, createdAt: { gt: since } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    return rows.map((row) => row.createdAt);
  }

  private async lastUnlockAt({ tx, weddingId }: { tx: Tx; weddingId: string }) {
    const row = await tx.applicationLog.findFirst({
      where: { weddingId, action: ACCESS_EMAIL_UNLOCKED_ACTION },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    return row?.createdAt ?? null;
  }

  private async log({
    tx,
    staff,
    weddingId,
    userId,
    action,
    data,
    ipHash,
    now,
  }: {
    tx: Tx;
    staff: StaffMember;
    weddingId: string;
    userId: string | null;
    action: string;
    data: Record<string, unknown>;
    ipHash: string | null;
    now: Date;
  }): Promise<void> {
    await tx.applicationLog.create({
      data: {
        id: uuidV7({ now: now.getTime() }),
        createdAt: now,
        action,
        actorKind: 'admin',
        actorUserId: staff.userId,
        weddingId,
        entityType: userId ? 'user' : 'wedding',
        entityId: userId ?? weddingId,
        data: data as Prisma.InputJsonValue,
        ipHash,
      },
    });
  }

  /**
   * O alerta aberto do mesmo tipo e entidade recebe o dado novo (a 2ª troca em
   * 7 dias pelo Admin, a nova liberação): um alerta só, com o retrato atual.
   */
  private async openAlert({
    tx,
    type,
    weddingId,
    entityType,
    entityId,
    data,
  }: {
    tx: Tx;
    type: 'access_email_changed' | 'access_email_locked' | 'access_email_unlocked';
    weddingId: string;
    entityType: string;
    entityId: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO alerts (id, type, wedding_id, entity_type, entity_id, data)
      VALUES (${uuidV7()}::uuid, ${type}::alert_type, ${weddingId}::uuid, ${entityType},
              ${entityId}, ${JSON.stringify(data)}::jsonb)
      ON CONFLICT (type, entity_type, entity_id) WHERE status = 'open'
      DO UPDATE SET data = EXCLUDED.data`;
  }
}
