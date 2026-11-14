import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import {
  EMAIL_OUTBOX,
  type EmailOutbox,
} from '../../../shared/email/application/email-outbox.port';
import {
  newAccessEmail,
  oldAccessEmail,
} from '../infrastructure/emails/access-email-changed.email';
import { LOGIN_CONFIRM_PATH } from '../infrastructure/outbox-login-code-mailer';
import {
  LOGIN_CHALLENGE_SECRETS,
  type LoginChallengeSecrets,
} from './ports/login-challenge-secrets.port';
import {
  LOGIN_CHALLENGE_STORE,
  type LoginChallengeStore,
} from './ports/login-challenge-store.port';
import { issueLoginChallengeIfAllowed } from './request-login-challenge.use-case';

/**
 * Os e-mails da troca do e-mail de acesso pelo staff (Backoffice - acesso
 * RN09): ao endereço novo, o botão de acesso (o mesmo pedido de 15 minutos e
 * uso único do login, RN04 de Login); ao antigo, o aviso com o novo mascarado.
 * Roda depois do commit da troca.
 */
@Injectable()
export class SendAccessEmailChanged {
  private readonly appUrl: string;

  constructor(
    @Inject(LOGIN_CHALLENGE_STORE) private readonly store: LoginChallengeStore,
    @Inject(LOGIN_CHALLENGE_SECRETS) private readonly secrets: LoginChallengeSecrets,
    @Inject(EMAIL_OUTBOX) private readonly outbox: EmailOutbox,
    config: AppConfigService,
  ) {
    this.appUrl = config.get({ key: 'APP_URL' });
  }

  async execute({
    oldEmail,
    newEmail,
    newEmailMasked,
    now,
  }: {
    oldEmail: string;
    newEmail: string;
    newEmailMasked: string;
    now: Date;
  }): Promise<void> {
    const issued = await this.store.exclusiveForEmail({
      email: newEmail,
      work: (transaction) =>
        issueLoginChallengeIfAllowed({
          transaction,
          secrets: this.secrets,
          email: newEmail,
          origin: 'none',
          originRef: null,
          requestIp: null,
          now,
        }),
    });
    // Sem o pedido (o limite da RN04), o e-mail sai sem o botão: a pessoa entra com o código.
    let accessUrl: string | null = null;
    if ('issued' in issued) {
      const url = new URL(LOGIN_CONFIRM_PATH, this.appUrl);
      url.searchParams.set('token', issued.issued.token);
      accessUrl = url.toString();
    }
    await this.outbox.enqueue({
      message: newAccessEmail({ to: newEmail, accessUrl }),
      priority: 'login',
    });
    await this.outbox.enqueue({
      message: oldAccessEmail({ to: oldEmail, newEmailMasked }),
      priority: 'default',
    });
  }
}
