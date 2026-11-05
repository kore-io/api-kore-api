import { Module } from '@nestjs/common';
import { AppConfigService } from '../../shared/config/app-config.service';
import { APP_GUARD } from '@nestjs/core';
import { AuthenticateSession } from './application/authenticate-session.use-case';
import { CompleteLogin } from './application/complete-login.use-case';
import { LOGIN_CHALLENGE_SECRETS } from './application/ports/login-challenge-secrets.port';
import { LOGIN_CHALLENGE_STORE } from './application/ports/login-challenge-store.port';
import { LOGIN_CODE_MAILER } from './application/ports/login-code-mailer.port';
import { PROFILE_DIRECTORY } from './application/ports/profile-directory.port';
import { USER_ACCOUNTS } from './application/ports/user-accounts.port';
import { RequestLoginChallenge } from './application/request-login-challenge.use-case';
import { VerifyLoginChallenge } from './application/verify-login-challenge.use-case';
import { EndAllSessions } from './application/end-all-sessions.use-case';
import { EndSession } from './application/end-session.use-case';
import { GetMe } from './application/get-me.use-case';
import { SESSION_REPOSITORY } from './application/ports/session-repository.port';
import { SESSION_TOKENS } from './application/ports/session-token.port';
import { USER_REPOSITORY } from './application/ports/user-repository.port';
import { StartSession } from './application/start-session.use-case';
import { HmacLoginChallengeSecrets } from './infrastructure/hmac-login-challenge-secrets';
import { OpaqueSessionTokens } from './infrastructure/opaque-session-tokens';
import { PrismaLoginChallengeStore } from './infrastructure/prisma-login-challenge.store';
import { PrismaProfileDirectory } from './infrastructure/prisma-profile-directory';
import { PrismaUserAccounts } from './infrastructure/prisma-user-accounts';
import { SmtpLoginCodeMailer } from './infrastructure/smtp-login-code-mailer';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { AuthController } from './presentation/auth.controller';
import { LoginController } from './presentation/login.controller';
import { MeController } from './presentation/me.controller';
import { SessionGuard } from './presentation/session.guard';

/** Contexto Acesso: sessão, login, papéis e convites de acesso. */
@Module({
  controllers: [AuthController, LoginController, MeController],
  providers: [
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: SESSION_TOKENS, useClass: OpaqueSessionTokens },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: LOGIN_CHALLENGE_STORE, useClass: PrismaLoginChallengeStore },
    {
      provide: LOGIN_CHALLENGE_SECRETS,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new HmacLoginChallengeSecrets({ codeKeyBase64: config.get({ key: 'LOGIN_CODE_KEY' }) }),
    },
    { provide: LOGIN_CODE_MAILER, useClass: SmtpLoginCodeMailer },
    { provide: USER_ACCOUNTS, useClass: PrismaUserAccounts },
    { provide: PROFILE_DIRECTORY, useClass: PrismaProfileDirectory },
    CompleteLogin,
    RequestLoginChallenge,
    VerifyLoginChallenge,
    AuthenticateSession,
    StartSession,
    EndSession,
    EndAllSessions,
    GetMe,
  ],
  exports: [StartSession],
})
export class AccessModule {}
