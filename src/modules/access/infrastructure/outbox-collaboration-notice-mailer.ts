import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import {
  EMAIL_OUTBOX,
  type EmailOutbox,
} from '../../../shared/email/application/email-outbox.port';
import type {
  CollaborationNoticeMailer,
  CoupleAcceptedNotice,
  PlannerLeftNotice,
} from '../application/ports/collaboration-notice-mailer.port';
import { coupleAcceptedEmail, plannerLeftEmail } from './emails/collaboration-notices.email';

/**
 * Colaboradores fica na Área do Casal (decisão 136(3), como o aviso de
 * recusa); o detalhe do casamento, na Área da cerimonialista.
 */
const COUPLE_AREA_PATH = '/app';
const plannerWeddingPath = (weddingId: string) =>
  `/cerimonialista/casamentos/${encodeURIComponent(weddingId)}`;

@Injectable()
export class OutboxCollaborationNoticeMailer implements CollaborationNoticeMailer {
  private readonly appUrl: string;

  constructor(
    @Inject(EMAIL_OUTBOX) private readonly outbox: EmailOutbox,
    config: AppConfigService,
  ) {
    this.appUrl = config.get({ key: 'APP_URL' });
  }

  async plannerLeft({ notice }: { notice: PlannerLeftNotice }): Promise<void> {
    const url = new URL(COUPLE_AREA_PATH, this.appUrl).toString();
    await this.outbox.enqueue({ message: plannerLeftEmail({ notice, url }), priority: 'default' });
  }

  async coupleAccepted({ notice }: { notice: CoupleAcceptedNotice }): Promise<void> {
    const url = new URL(plannerWeddingPath(notice.weddingId), this.appUrl).toString();
    await this.outbox.enqueue({
      message: coupleAcceptedEmail({ notice, url }),
      priority: 'default',
    });
  }
}
