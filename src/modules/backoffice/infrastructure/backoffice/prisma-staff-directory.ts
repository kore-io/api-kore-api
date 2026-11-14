import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type { StaffRole } from '../../domain/staff';
import type { StaffDirectory } from '../../application/ports/staff-directory.port';

/** Pela conexão do backoffice (decisão 180(5)): as rotas /v1/admin leem fora da RLS. */
@Injectable()
export class PrismaStaffDirectory implements StaffDirectory {
  constructor(private readonly db: BackofficePrismaService) {}

  async roleOf({ userId }: { userId: string }): Promise<StaffRole | null> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { platformRole: true, status: true },
    });
    if (!user || user.status !== 'active' || user.platformRole === 'none') return null;
    return user.platformRole;
  }
}
