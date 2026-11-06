import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { EmailDeliveryFailures } from '../../../shared/email/application/email-delivery-failures';
import type { EmailTag } from '../../../shared/email/application/email-outbox.port';
import {
  OWNERLESS_WEDDINGS,
  type OwnerlessWeddings,
} from '../application/ports/ownerless-weddings.port';
import { PURGE_NOTICE_EMAIL_TAG } from './outbox-purge-notice-mailer';

/**
 * Quando o worker desiste do e-mail 6 depois das tentativas, desfaz a marca do
 * aviso: o casamento não é expurgado sem o indicador ter sido avisado
 * (decisão 180(8)); a rotina avisa de novo no dia seguinte.
 */
@Injectable()
export class PurgeNoticeGiveUpHandler implements OnModuleInit {
  readonly kind = PURGE_NOTICE_EMAIL_TAG;

  constructor(
    private readonly failures: EmailDeliveryFailures,
    @Inject(OWNERLESS_WEDDINGS) private readonly weddings: OwnerlessWeddings,
  ) {}

  onModuleInit(): void {
    this.failures.register({ handler: this });
  }

  async onGaveUp({ tag }: { tag: EmailTag }): Promise<void> {
    const { weddingId, noticeSentAt } = tag.data;
    if (!weddingId || !noticeSentAt) return;
    await this.weddings.clearNotice({ weddingId, noticeSentAt: new Date(noticeSentAt) });
  }
}
