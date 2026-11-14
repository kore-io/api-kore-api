import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import type { IdentityDirectory } from '../application/ports/identity-directory.port';
import type { AuthMethod } from '../domain/authenticated-session';

@Injectable()
export class PrismaIdentityDirectory implements IdentityDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async providers({ userId }: { userId: string }): Promise<AuthMethod[]> {
    const identities = await this.prisma.authIdentity.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { provider: true },
    });
    return [...new Set(identities.map((identity) => identity.provider))];
  }
}
