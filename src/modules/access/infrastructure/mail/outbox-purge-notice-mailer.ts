import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '@/shared/config/app-config.service';
import { EMAIL_OUTBOX, type EmailOutbox } from '@/shared/email/application/email-outbox.port';
import type {
  PurgeNotice,
  PurgeNoticeMailer,
} from '@/modules/access/application/ports/purge-notice-mailer.port';
import { plannerWeddingPath } from './planner-wedding-path';
import { purgeNoticeEmail } from './templates/purge-notice.email';

/** Etiqueta do e-mail 6, para a desistência do worker desfazer a marca (decisão 180(8)). */
export const PURGE_NOTICE_EMAIL_TAG = 'purge_notice';

@Injectable()
export class OutboxPurgeNoticeMailer implements PurgeNoticeMailer {
  private readonly appUrl: string;

  constructor(
    @Inject(EMAIL_OUTBOX) private readonly outbox: EmailOutbox,
    config: AppConfigService,
  ) {
    this.appUrl = config.get({ key: 'APP_URL' });
  }

  async send({ notice }: { notice: PurgeNotice }): Promise<void> {
    // Abrir o casamento: o detalhe na Área do cerimonialista (Novo casamento
    // pelo cerimonialista RN10; Cadastro e perfil do cerimonialista RN07).
    const url = new URL(plannerWeddingPath(notice.weddingId), this.appUrl).toString();
    await this.outbox.enqueue({
      message: purgeNoticeEmail({ notice, url }),
      priority: 'default',
      tag: {
        kind: PURGE_NOTICE_EMAIL_TAG,
        data: { weddingId: notice.weddingId, noticeSentAt: notice.noticeSentAt.toISOString() },
      },
    });
  }
}
