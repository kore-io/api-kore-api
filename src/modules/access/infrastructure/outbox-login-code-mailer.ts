import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import {
  EMAIL_OUTBOX,
  type EmailOutbox,
} from '../../../shared/email/application/email-outbox.port';
import type { LoginCodeMailer } from '../application/ports/login-code-mailer.port';
import { loginCodeEmail } from './emails/login-code.email';

/** Rota do app que recebe o token do botão de acesso (decisão 139). */
export const LOGIN_CONFIRM_PATH = '/entrar/confirmar';

/** O código de login vai pela fila prioritária (ADR do SES; decisão 139). */
@Injectable()
export class OutboxLoginCodeMailer implements LoginCodeMailer {
  private readonly appUrl: string;

  constructor(
    @Inject(EMAIL_OUTBOX) private readonly outbox: EmailOutbox,
    config: AppConfigService,
  ) {
    this.appUrl = config.get({ key: 'APP_URL' });
  }

  async send({
    email,
    code,
    token,
  }: {
    email: string;
    code: string;
    token: string;
  }): Promise<void> {
    const accessUrl = new URL(LOGIN_CONFIRM_PATH, this.appUrl);
    accessUrl.searchParams.set('token', token);
    await this.outbox.enqueue({
      message: loginCodeEmail({ to: email, code, accessUrl: accessUrl.toString() }),
      priority: 'login',
    });
  }
}
