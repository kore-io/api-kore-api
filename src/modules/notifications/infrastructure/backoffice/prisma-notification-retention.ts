import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type { NotificationRetention } from '../../application/ports/notification-retention.port';

/** Pela conexão do backoffice (sem RLS): a rotina atravessa os casamentos. */
@Injectable()
export class PrismaNotificationRetention implements NotificationRetention {
  constructor(private readonly prisma: BackofficePrismaService) {}

  async deleteRead({ readBefore }: { readBefore: Date }): Promise<number> {
    const { count } = await this.prisma.notification.deleteMany({
      where: { readAt: { lt: readBefore } },
    });
    return count;
  }
}
