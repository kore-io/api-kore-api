import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import {
  EMAIL_OUTBOX,
  type EmailOutbox,
} from '../../../shared/email/application/email-outbox.port';
import type {
  InvitationEmail,
  InvitationMailer,
} from '../application/ports/invitation-mailer.port';
import { accessInvitationEmail } from './emails/access-invitation.email';

/** Rota do app que abre o convite (decisão 139). */
export const INVITATION_PATH = '/convite';

/** Convites de acesso pela fila comum de e-mail (ADR do SES). */
@Injectable()
export class OutboxInvitationMailer implements InvitationMailer {
  private readonly appUrl: string;

  constructor(
    @Inject(EMAIL_OUTBOX) private readonly outbox: EmailOutbox,
    config: AppConfigService,
  ) {
    this.appUrl = config.get({ key: 'APP_URL' });
  }

  async send({ email }: { email: InvitationEmail }): Promise<void> {
    await this.outbox.enqueue({
      message: accessInvitationEmail({ email, url: this.urlFor({ token: email.token }) }),
      priority: 'default',
    });
  }

  urlFor({ token }: { token: string }): string {
    return new URL(`${INVITATION_PATH}/${encodeURIComponent(token)}`, this.appUrl).toString();
  }
}
