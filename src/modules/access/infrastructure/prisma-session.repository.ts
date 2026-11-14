import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { AuthMethod, ProfileKind } from '../domain/authenticated-session';
import type {
  SessionRecord,
  SessionRepository,
} from '../application/ports/session-repository.port';

@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantTransaction,
  ) {}

  async create({
    userId,
    tokenHash,
    now,
    expiresAt,
    authMethod,
    staffDomain,
    userAgent,
  }: {
    userId: string;
    tokenHash: string;
    now: Date;
    expiresAt: Date;
    authMethod: AuthMethod;
    staffDomain: string | null;
    userAgent?: string;
  }): Promise<{ id: string }> {
    return this.prisma.session.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        lastSeenAt: now,
        authenticatedAt: now,
        authMethod,
        staffDomain,
        userAgent,
      },
      select: { id: true },
    });
  }

  async findByTokenHash({ tokenHash }: { tokenHash: string }): Promise<SessionRecord | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: { select: { status: true } } },
    });
    if (!session) return null;
    return {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
      lastSeenAt: session.lastSeenAt,
      authenticatedAt: session.authenticatedAt,
      authMethod: session.authMethod,
      activeProfile: session.activeProfile,
      staffDomain: session.staffDomain,
      supportSessionId: session.supportSessionId,
      revokedAt: session.revokedAt,
      userStatus: session.user.status,
    };
  }

  async renew({
    sessionId,
    now,
    expiresAt,
  }: {
    sessionId: string;
    now: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { lastSeenAt: now, expiresAt },
    });
  }

  async revoke({ sessionId, now }: { sessionId: string; now: Date }): Promise<void> {
    const tx = this.tenant.optionalClient();
    await (tx ?? this.prisma).session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
    // Sair apaga o push deste aparelho na mesma transação (E-mail e push RN08):
    // a sessão não é apagada, então o CASCADE da assinatura não basta. Fora da
    // transação da requisição (sessão vencida), o worker ignora e apaga.
    if (tx) await this.dropPush({ tx, where: { sessionId } });
  }

  async revokeAllForUser({ userId, now }: { userId: string; now: Date }): Promise<void> {
    const tx = this.tenant.optionalClient();
    await (tx ?? this.prisma).session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    if (tx) await this.dropPush({ tx, where: { userId } });
  }

  /**
   * Apaga as assinaturas de push (pela RLS, só as da pessoa) e, sem nenhuma
   * sobrando, desliga a preferência push dela (decisão 217(8)).
   */
  private async dropPush({
    tx,
    where,
  }: {
    tx: NonNullable<ReturnType<TenantTransaction['optionalClient']>>;
    where: { sessionId: string } | { userId: string };
  }): Promise<void> {
    await tx.pushSubscription.deleteMany({ where });
    const userId =
      'userId' in where
        ? where.userId
        : (
            await tx.session.findUnique({
              where: { id: where.sessionId },
              select: { userId: true },
            })
          )?.userId;
    if (userId && (await tx.pushSubscription.count({ where: { userId } })) === 0)
      await tx.notificationPreference.updateMany({ where: { userId }, data: { push: false } });
  }

  async setActiveProfile({
    sessionId,
    userId,
    profile,
  }: {
    sessionId: string;
    userId: string;
    profile: ProfileKind;
  }): Promise<void> {
    await (this.tenant.optionalClient() ?? this.prisma).session.updateMany({
      where: { id: sessionId, userId },
      data: { activeProfile: profile },
    });
  }
}
