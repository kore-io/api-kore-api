import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { EmailDeliveryFailures } from '../../../shared/email/application/email-delivery-failures';
import type { EmailTag } from '../../../shared/email/application/email-outbox.port';
import {
  WEDDING_RETENTION_STORE,
  type WeddingRetentionStore,
} from '../application/ports/wedding-retention.port';
import { PURGE_SOON_EMAIL_TAG } from './outbox-billing-mailer';

/**
 * Quando o worker desiste do aviso de 30 dias depois das tentativas, desfaz a
 * marca: aviso que falhou não conta e o expurgo espera (Retenção e expurgo
 * RN02; decisão 180(8)). A rotina avisa de novo no dia seguinte.
 */
@Injectable()
export class PurgeSoonGiveUpHandler implements OnModuleInit {
  readonly kind = PURGE_SOON_EMAIL_TAG;

  constructor(
    private readonly failures: EmailDeliveryFailures,
    @Inject(WEDDING_RETENTION_STORE) private readonly store: WeddingRetentionStore,
  ) {}

  onModuleInit(): void {
    this.failures.register({ handler: this });
  }

  async onGaveUp({ tag }: { tag: EmailTag }): Promise<void> {
    const { weddingId, noticeSentAt } = tag.data;
    if (!weddingId || !noticeSentAt) return;
    await this.store.clearNotice({
      weddingId,
      noticeSentAt: new Date(noticeSentAt),
      now: new Date(),
    });
  }
}
