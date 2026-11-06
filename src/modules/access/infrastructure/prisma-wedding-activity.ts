import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { WeddingActivity } from '../application/ports/wedding-activity.port';

/** Para não escrever a cada requisição: no máximo uma vez por hora (decisão 180). */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class PrismaWeddingActivity implements WeddingActivity {
  constructor(private readonly tenant: TenantTransaction) {}

  async touch({ weddingId, now }: { weddingId: string; now: Date }): Promise<void> {
    await this.tenant.client().wedding.updateMany({
      where: { id: weddingId, lastActivityAt: { lt: new Date(now.getTime() - TOUCH_INTERVAL_MS) } },
      data: { lastActivityAt: now, purgeNoticeSentAt: null },
    });
  }
}
