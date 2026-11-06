import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import {
  EMAIL_OUTBOX,
  type EmailOutbox,
} from '../../../shared/email/application/email-outbox.port';
import type { PurgeNotice, PurgeNoticeMailer } from '../application/ports/purge-notice-mailer.port';
import { purgeNoticeEmail } from './emails/purge-notice.email';

/** Etiqueta do e-mail 6, para a desistência do worker desfazer a marca (decisão 180(8)). */
export const PURGE_NOTICE_EMAIL_TAG = 'purge_notice';

/** A área do indicador nasce na F6; até lá, a Seleção de perfil (decisão 180). */
const REFERRER_PATH = '/perfis';

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
    const url = new URL(REFERRER_PATH, this.appUrl).toString();
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
