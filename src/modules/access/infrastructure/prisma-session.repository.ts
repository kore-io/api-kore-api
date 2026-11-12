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
    userAgent,
  }: {
    userId: string;
    tokenHash: string;
    now: Date;
    expiresAt: Date;
    authMethod: AuthMethod;
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
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async revokeAllForUser({ userId, now }: { userId: string; now: Date }): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
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
