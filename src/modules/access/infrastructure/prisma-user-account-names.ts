import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { UserAccountNames } from '../application/ports/user-account-names.port';

@Injectable()
export class PrismaUserAccountNames implements UserAccountNames {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantTransaction,
  ) {}

  async setName({ userId, name }: { userId: string; name: string }): Promise<void> {
    await (this.tenant.optionalClient() ?? this.prisma).user.updateMany({
      where: { id: userId },
      data: { name },
    });
  }

  async nameByEmail({ email }: { email: string }): Promise<string | null> {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { name: true } });
    return user?.name ?? null;
  }
}
