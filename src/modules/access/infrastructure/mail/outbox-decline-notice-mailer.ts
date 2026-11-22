import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '@/shared/config/app-config.service';
import { EMAIL_OUTBOX, type EmailOutbox } from '@/shared/email/application/email-outbox.port';
import type {
  DeclineNotice,
  DeclineNoticeMailer,
} from '@/modules/access/application/ports/decline-notice-mailer.port';
import { plannerWeddingPath } from './planner-wedding-path';
import { declineNoticeEmail } from './templates/decline-notice.email';

/**
 * Dono → Colaboradores na Área do Casal (decisão 136(3); a tela do D5b da F6);
 * indicador → o detalhe do casamento na Área do cerimonialista (Cadastro e
 * perfil do cerimonialista RN07).
 */
const OWNER_PATH = '/app/colaboradores';

@Injectable()
export class OutboxDeclineNoticeMailer implements DeclineNoticeMailer {
  private readonly appUrl: string;

  constructor(
    @Inject(EMAIL_OUTBOX) private readonly outbox: EmailOutbox,
    config: AppConfigService,
  ) {
    this.appUrl = config.get({ key: 'APP_URL' });
  }

  async send({ notice }: { notice: DeclineNotice }): Promise<void> {
    const path = notice.inviterIsOwner ? OWNER_PATH : plannerWeddingPath(notice.weddingId);
    const url = new URL(path, this.appUrl).toString();
    await this.outbox.enqueue({
      message: declineNoticeEmail({ notice, url }),
      priority: 'default',
    });
  }
}
