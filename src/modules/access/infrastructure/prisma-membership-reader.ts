import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { MembershipReader } from '../application/ports/membership-reader.port';
import type { MembershipRole } from '../domain/wedding-authorization';

@Injectable()
export class PrismaMembershipReader implements MembershipReader {
  constructor(private readonly tenant: TenantTransaction) {}

  async activeRole({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<MembershipRole | null> {
    const membership = await this.tenant.client().membership.findFirst({
      where: { userId, weddingId, removedAt: null },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  async hasActiveOwner({ weddingId }: { weddingId: string }): Promise<boolean> {
    const owners = await this.tenant.client().membership.count({
      where: { weddingId, role: 'owner', removedAt: null },
    });
    return owners > 0;
  }

  weddingOrigin({
    weddingId,
  }: {
    weddingId: string;
  }): Promise<{ createdByUserId: string | null; referralSource: string | null } | null> {
    return this.tenant.client().wedding.findFirst({
      where: { id: weddingId },
      select: { createdByUserId: true, referralSource: true },
    });
  }
}
