import { Inject, Injectable } from '@nestjs/common';
import {
  InvalidLoginCodeError,
  LoginChallengeExpiredError,
  LoginChallengeLockedError,
  LoginRequestTooSoonError,
} from '../domain/access.errors';
import {
  isLoginChallengeUsable,
  LOGIN_CHALLENGE_MAX_ATTEMPTS,
} from '../domain/login-challenge-rules';
import { CompleteLogin, type CompletedLogin } from './complete-login.use-case';
import {
  LOGIN_CHALLENGE_SECRETS,
  type LoginChallengeSecrets,
} from './ports/login-challenge-secrets.port';
import {
  LOGIN_CHALLENGE_STORE,
  type LoginChallengeRecord,
  type LoginChallengeStore,
} from './ports/login-challenge-store.port';
import { LOGIN_CODE_MAILER, type LoginCodeMailer } from './ports/login-code-mailer.port';
import {
  issueLoginChallengeIfAllowed,
  type IssuedChallenge,
} from './request-login-challenge.use-case';

export type LoginCredentials = { email: string; code: string } | { token: string };

type CodeCheck =
  | { outcome: 'ok'; challenge: LoginChallengeRecord }
  | { outcome: 'expired' }
  | { outcome: 'wrong'; attemptsLeft: number }
  | { outcome: 'locked'; reissued: IssuedChallenge; retryAfterMinutes?: undefined }
  | { outcome: 'locked'; reissued: null; retryAfterMinutes: number };

/**
 * Confirma o login pelo código ou pelo botão do e-mail (RN01, RN02 e RN05 de
 * Login). Usar um invalida o outro, porque os dois são o mesmo pedido.
 */
@Injectable()
export class VerifyLoginChallenge {
  constructor(
    @Inject(LOGIN_CHALLENGE_STORE) private readonly store: LoginChallengeStore,
    @Inject(LOGIN_CHALLENGE_SECRETS) private readonly secrets: LoginChallengeSecrets,
    @Inject(LOGIN_CODE_MAILER) private readonly mailer: LoginCodeMailer,
    private readonly completeLogin: CompleteLogin,
  ) {}

  async execute({
    credentials,
    ip,
    userAgent,
    now,
  }: {
    credentials: LoginCredentials;
    ip: string | null;
    userAgent?: string;
    now: Date;
  }): Promise<CompletedLogin> {
    const challenge =
      'token' in credentials
        ? await this.consumeByToken({ token: credentials.token, now })
        : await this.consumeByCode({ ...credentials, ip, now });

    return this.completeLogin.execute({
      email: challenge.email,
      method: 'email',
      providerSubject: challenge.email.toLowerCase(),
      origin: challenge.origin,
      ip,
      userAgent,
      now,
    });
  }

  private async consumeByToken({ token, now }: { token: string; now: Date }) {
    const challenge = await this.store.findByTokenHash({
      tokenHash: this.secrets.hashToken({ token }),
    });
    if (!challenge || !isLoginChallengeUsable({ challenge, now }))
      throw new LoginChallengeExpiredError();
    const consumed = await this.store.exclusiveForEmail({
      email: challenge.email,
      work: (transaction) => transaction.consume({ id: challenge.id, now }),
    });
    if (!consumed) throw new LoginChallengeExpiredError();
    return challenge;
  }

  private async consumeByCode({
    email,
    code,
    ip,
    now,
  }: {
    email: string;
    code: string;
    ip: string | null;
    now: Date;
  }): Promise<LoginChallengeRecord> {
    // O resultado sai da transação antes de virar erro: um erro dentro dela
    // desfaria a tentativa errada já contada (RN05).
    const check = await this.store.exclusiveForEmail<CodeCheck>({
      email,
      work: async (transaction) => {
        const challenge = await transaction.findLatestOpen({ email });
        if (!challenge || !isLoginChallengeUsable({ challenge, now }))
          return { outcome: 'expired' };

        if (this.secrets.matchesCode({ code, codeHash: challenge.codeHash })) {
          return (await transaction.consume({ id: challenge.id, now }))
            ? { outcome: 'ok', challenge }
            : { outcome: 'expired' };
        }

        const attempts = await transaction.registerFailedAttempt({ id: challenge.id });
        if (attempts < LOGIN_CHALLENGE_MAX_ATTEMPTS) {
          return { outcome: 'wrong', attemptsLeft: LOGIN_CHALLENGE_MAX_ATTEMPTS - attempts };
        }

        // RN05: o quinto erro invalida o pedido; se a RN04 deixar, um código novo sai sozinho.
        await transaction.invalidate({ id: challenge.id, now });
        const reissue = await issueLoginChallengeIfAllowed({
          transaction,
          secrets: this.secrets,
          email,
          origin: challenge.origin,
          originRef: challenge.originRef,
          requestIp: ip,
          now,
        });
        if ('issued' in reissue) return { outcome: 'locked', reissued: reissue.issued };
        // Decisão 150: sem código novo, diz em quantos minutos pode pedir outro
        // (arredondado para cima, nunca 0).
        const refusal = reissue.refused;
        const retryAfterMinutes =
          refusal instanceof LoginRequestTooSoonError
            ? Math.max(1, Math.ceil((refusal.resendAvailableAt.getTime() - now.getTime()) / 60_000))
            : refusal.retryAfterMinutes;
        return { outcome: 'locked', reissued: null, retryAfterMinutes };
      },
    });

    switch (check.outcome) {
      case 'ok':
        return check.challenge;
      case 'expired':
        throw new LoginChallengeExpiredError();
      case 'wrong':
        throw new InvalidLoginCodeError({ attemptsLeft: check.attemptsLeft });
      case 'locked':
        if (check.reissued) {
          await this.mailer.send({ email, ...check.reissued });
          throw new LoginChallengeLockedError({ newCodeSent: true });
        }
        throw new LoginChallengeLockedError({
          newCodeSent: false,
          retryAfterMinutes: check.retryAfterMinutes,
        });
    }
  }
}
