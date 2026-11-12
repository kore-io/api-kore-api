import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import type { UserAccount, UserAccounts } from '../application/ports/user-accounts.port';

const ACCOUNT_FIELDS = { id: true, email: true, status: true } as const;

@Injectable()
export class PrismaUserAccounts implements UserAccounts {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail({ email }: { email: string }): Promise<UserAccount | null> {
    return this.prisma.user.findUnique({ where: { email }, select: ACCOUNT_FIELDS });
  }

  async createOrGet({
    email,
  }: {
    email: string;
  }): Promise<{ account: UserAccount; created: boolean }> {
    const existing = await this.findByEmail({ email });
    if (existing) return { account: existing, created: false };
    try {
      const account = await this.prisma.user.create({ data: { email }, select: ACCOUNT_FIELDS });
      return { account, created: true };
    } catch (error) {
      // Outro login do mesmo e-mail criou a conta entre a leitura e a escrita.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const account = await this.findByEmail({ email });
        if (account) return { account, created: false };
      }
      throw error;
    }
  }

  async ensureIdentity({
    userId,
    provider,
    providerSubject,
  }: {
    userId: string;
    provider: 'email' | 'google';
    providerSubject: string;
  }): Promise<void> {
    await this.prisma.authIdentity.createMany({
      data: [{ userId, provider, providerSubject }],
      skipDuplicates: true,
    });
  }

  async recordLogin({ userId, now }: { userId: string; now: Date }): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: now } });
  }
}
