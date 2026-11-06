import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import {
  EMAIL_OUTBOX,
  type EmailOutbox,
} from '../../../shared/email/application/email-outbox.port';
import type {
  DeclineNotice,
  DeclineNoticeMailer,
} from '../application/ports/decline-notice-mailer.port';
import { declineNoticeEmail } from './emails/decline-notice.email';

/** Dono → Área do Casal; indicador → Seleção de perfil (decisões 146 e 172). */
const OWNER_PATH = '/app';
const REFERRER_PATH = '/perfis';

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
    const url = new URL(notice.inviterIsOwner ? OWNER_PATH : REFERRER_PATH, this.appUrl).toString();
    await this.outbox.enqueue({
      message: declineNoticeEmail({ notice, url }),
      priority: 'default',
    });
  }
}
