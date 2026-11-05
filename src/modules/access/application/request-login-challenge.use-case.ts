import { Inject, Injectable } from '@nestjs/common';
import { LoginRequestLimitError, LoginRequestTooSoonError } from '../domain/access.errors';
import {
  evaluateLoginRequestQuota,
  LOGIN_CHALLENGE_TTL_MS,
  LOGIN_REQUEST_INTERVAL_MS,
  LOGIN_REQUEST_WINDOW_MS,
} from '../domain/login-challenge-rules';
import { storableOriginRef, type LoginOrigin } from '../domain/login-next-step';
import {
  LOGIN_CHALLENGE_SECRETS,
  type LoginChallengeSecrets,
} from './ports/login-challenge-secrets.port';
import {
  LOGIN_CHALLENGE_STORE,
  type LoginChallengeStore,
  type LoginChallengeTransaction,
} from './ports/login-challenge-store.port';
import { LOGIN_CODE_MAILER, type LoginCodeMailer } from './ports/login-code-mailer.port';

export interface IssuedChallenge {
  token: string;
  code: string;
}

/**
 * Cria um pedido novo dentro da transação do e-mail, se a RN04 deixar: o
 * anterior deixa de valer. Usado pelo pedido de código e pelo código novo da
 * RN05. Devolve null quando o limite da RN04 não deixa.
 */
export async function issueLoginChallengeIfAllowed({
  transaction,
  secrets,
  email,
  origin,
  originRef,
  requestIp,
  now,
}: {
  transaction: LoginChallengeTransaction;
  secrets: LoginChallengeSecrets;
  email: string;
  origin: LoginOrigin;
  originRef: string | null;
  requestIp: string | null;
  now: Date;
}): Promise<
  { issued: IssuedChallenge } | { refused: LoginRequestTooSoonError | LoginRequestLimitError }
> {
  const recentRequests = await transaction.listRequestTimesSince({
    email,
    since: new Date(now.getTime() - LOGIN_REQUEST_WINDOW_MS),
  });
  const quota = evaluateLoginRequestQuota({ recentRequests, now });
  if (!quota.allowed) {
    return {
      refused:
        quota.reason === 'too_soon'
          ? new LoginRequestTooSoonError({ resendAvailableAt: quota.resendAvailableAt })
          : new LoginRequestLimitError({ retryAfterMinutes: quota.retryAfterMinutes }),
    };
  }

  const { token, tokenHash, code, codeHash } = secrets.issue();
  await transaction.invalidateActive({ email, now });
  await transaction.create({
    challenge: {
      email,
      tokenHash,
      codeHash,
      expiresAt: new Date(now.getTime() + LOGIN_CHALLENGE_TTL_MS),
      origin,
      originRef: storableOriginRef({ origin, originRef }),
      requestIp,
    },
  });
  return { issued: { token, code } };
}

/**
 * Pede um código (RN01 a RN04 de Login). O e-mail sai exista conta ou não, e a
 * resposta é a mesma nos dois casos (RN03).
 */
@Injectable()
export class RequestLoginChallenge {
  constructor(
    @Inject(LOGIN_CHALLENGE_STORE) private readonly store: LoginChallengeStore,
    @Inject(LOGIN_CHALLENGE_SECRETS) private readonly secrets: LoginChallengeSecrets,
    @Inject(LOGIN_CODE_MAILER) private readonly mailer: LoginCodeMailer,
  ) {}

  async execute({
    email,
    origin,
    originRef,
    requestIp,
    now,
  }: {
    email: string;
    origin: LoginOrigin;
    originRef: string | null;
    requestIp: string | null;
    now: Date;
  }): Promise<{ email: string; resendAvailableAt: Date }> {
    const result = await this.store.exclusiveForEmail({
      email,
      work: (transaction) =>
        issueLoginChallengeIfAllowed({
          transaction,
          secrets: this.secrets,
          email,
          origin,
          originRef,
          requestIp,
          now,
        }),
    });
    if ('refused' in result) throw result.refused;

    await this.mailer.send({ email, ...result.issued });
    return { email, resendAvailableAt: new Date(now.getTime() + LOGIN_REQUEST_INTERVAL_MS) };
  }
}
