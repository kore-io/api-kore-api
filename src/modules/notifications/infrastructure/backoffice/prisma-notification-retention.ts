import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import type { NotificationRetention } from '@/modules/notifications/application/ports/notification-retention.port';

/** Pela conexão do backoffice (sem RLS): a rotina atravessa os casamentos. */
@Injectable()
export class PrismaNotificationRetention implements NotificationRetention {
  constructor(private readonly prisma: BackofficePrismaService) {}

  /**
   * Decisão 290(1) (Casamento bloqueado, Objetivo: "nenhuma rotina apaga
   * nada"): as do casamento bloqueado ficam; saem pela idade depois do
   * desbloqueio.
   */
  async deleteRead({ readBefore }: { readBefore: Date }): Promise<number> {
    const { count } = await this.prisma.notification.deleteMany({
      where: { readAt: { lt: readBefore }, wedding: { blockedAt: null } },
    });
    return count;
  }
}
