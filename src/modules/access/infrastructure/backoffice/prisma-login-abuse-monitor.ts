import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import {
  LOGIN_ABUSE_MAX_FAILURES,
  LOGIN_ABUSE_WINDOW_MS,
} from '@/modules/access/domain/login/login-challenge-rules';
import type { LoginAbuseMonitor } from '@/modules/access/application/ports/login-abuse-monitor.port';
import { maskEmail } from '@/shared/kernel/text/mask-email';
import { IpHasher } from '@/modules/logs/infrastructure/providers/ip-hasher';
import { AppConfigService } from '@/shared/config/app-config.service';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { uuidV7 } from '@/shared/kernel/ids/uuid-v7';

export const LOGIN_CODE_FAILED_ACTION = 'login.code_failed';

type Tx = Parameters<Parameters<BackofficePrismaService['$transaction']>[0]>[0];

/**
 * Pela conexão do backoffice (o kore_app não lê o log nem grava alerta): cada
 * código errado deixa uma linha `login.code_failed` no log, com o e-mail e o
 * IP só em hash, e o alerta é a consulta fixa sobre o log (Modelo de Dados,
 * `Alert`). Um alerta aberto por e-mail e outro por IP, pelo índice único de
 * aberto; enquanto aberto, só a contagem é atualizada.
 */
@Injectable()
export class PrismaLoginAbuseMonitor implements LoginAbuseMonitor {
  private readonly key: Buffer;

  constructor(
    private readonly db: BackofficePrismaService,
    private readonly ipHasher: IpHasher,
    config: AppConfigService,
  ) {
    this.key = Buffer.from(config.get({ key: 'IP_HASH_KEY' }), 'base64');
  }

  async recordFailure({
    email,
    ip,
    now,
  }: {
    email: string;
    ip: string | null;
    now: Date;
  }): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const emailHash = createHmac('sha256', this.key)
      .update(`login.email:${normalized}`)
      .digest('base64url');
    const ipHash = ip ? this.ipHasher.hash({ ip }) : null;
    const since = new Date(now.getTime() - LOGIN_ABUSE_WINDOW_MS);

    await this.db.$transaction(async (tx) => {
      await tx.applicationLog.create({
        data: {
          id: uuidV7({ now: now.getTime() }),
          createdAt: now,
          actorKind: 'system',
          action: LOGIN_CODE_FAILED_ACTION,
          entityType: 'login_email',
          entityId: emailHash,
          ipHash,
        },
      });
      const byEmail = await tx.applicationLog.count({
        where: {
          action: LOGIN_CODE_FAILED_ACTION,
          entityId: emailHash,
          createdAt: { gt: since, lte: now },
        },
      });
      if (byEmail > LOGIN_ABUSE_MAX_FAILURES) {
        const user = await tx.user.findUnique({
          where: { email: normalized },
          select: { id: true },
        });
        await this.openAlert({
          tx,
          entityType: 'login_email',
          entityId: emailHash,
          userId: user?.id ?? null,
          data: { emailMasked: maskEmail(normalized), failures: byEmail, windowMinutes: 60 },
          now,
        });
      }
      if (!ipHash) return;
      const byIp = await tx.applicationLog.count({
        where: { action: LOGIN_CODE_FAILED_ACTION, ipHash, createdAt: { gt: since, lte: now } },
      });
      if (byIp > LOGIN_ABUSE_MAX_FAILURES)
        await this.openAlert({
          tx,
          entityType: 'login_ip',
          entityId: ipHash,
          userId: null,
          data: { ipHashShort: ipHash.slice(0, 8), failures: byIp, windowMinutes: 60 },
          now,
        });
    });
  }

  private async openAlert({
    tx,
    entityType,
    entityId,
    userId,
    data,
    now,
  }: {
    tx: Tx;
    entityType: 'login_email' | 'login_ip';
    entityId: string;
    userId: string | null;
    data: Record<string, unknown>;
    now: Date;
  }): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO alerts (id, created_at, type, user_id, entity_type, entity_id, data)
      VALUES (${uuidV7({ now: now.getTime() })}::uuid, ${now}, 'login_abuse'::alert_type,
              ${userId}::uuid, ${entityType}, ${entityId}, ${JSON.stringify(data)}::jsonb)
      ON CONFLICT (type, entity_type, entity_id) WHERE status = 'open'
      DO UPDATE SET data = EXCLUDED.data`;
  }
}
