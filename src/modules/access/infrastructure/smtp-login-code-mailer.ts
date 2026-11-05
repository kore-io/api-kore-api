import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import {
  EMAIL_SENDER,
  type EmailSender,
} from '../../../shared/email/application/email-sender.port';
import type { LoginCodeMailer } from '../application/ports/login-code-mailer.port';
import { loginCodeEmail } from './emails/login-code.email';

/** Rota do app que recebe o token do botão de acesso (decisão 139). */
export const LOGIN_CONFIRM_PATH = '/entrar/confirmar';

/** Envio síncrono por enquanto; a fila de e-mails entra na 59-fila-emails (decisão 139). */
@Injectable()
export class SmtpLoginCodeMailer implements LoginCodeMailer {
  private readonly appUrl: string;

  constructor(
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
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
    await this.sender.send({
      message: loginCodeEmail({ to: email, code, accessUrl: accessUrl.toString() }),
    });
  }
}
