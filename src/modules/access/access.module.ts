import { Module } from '@nestjs/common';
import { AppConfigService } from '../../shared/config/app-config.service';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthenticateSession } from './application/authenticate-session.use-case';
import { CompleteGoogleLogin } from './application/complete-google-login.use-case';
import { CompleteLogin } from './application/complete-login.use-case';
import { GOOGLE_IDENTITY_PROVIDER } from './application/ports/google-identity-provider.port';
import { StartGoogleLogin } from './application/start-google-login.use-case';
import { MEMBERSHIP_READER } from './application/ports/membership-reader.port';
import { WeddingAuthorization } from './application/wedding-authorization.service';
import { LOGIN_CHALLENGE_SECRETS } from './application/ports/login-challenge-secrets.port';
import { LOGIN_CHALLENGE_STORE } from './application/ports/login-challenge-store.port';
import { LOGIN_CODE_MAILER } from './application/ports/login-code-mailer.port';
import { REFERRAL_DIRECTORY } from './application/ports/referral-directory.port';
import { GetReferral } from './application/get-referral.use-case';
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
import { DevGoogleProvider } from './infrastructure/dev-google.provider';
import { GoogleOidcProvider } from './infrastructure/google-oidc.provider';
import { HmacLoginChallengeSecrets } from './infrastructure/hmac-login-challenge-secrets';
import { OpaqueSessionTokens } from './infrastructure/opaque-session-tokens';
import { PrismaLoginChallengeStore } from './infrastructure/prisma-login-challenge.store';
import { PrismaMembershipReader } from './infrastructure/prisma-membership-reader';
import { PrismaReferralDirectory } from './infrastructure/prisma-referral-directory';
import { PrismaProfileDirectory } from './infrastructure/prisma-profile-directory';
import { PrismaUserAccounts } from './infrastructure/prisma-user-accounts';
import { OutboxLoginCodeMailer } from './infrastructure/outbox-login-code-mailer';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { AuthController } from './presentation/auth.controller';
import { GoogleLoginController } from './presentation/google-login.controller';
import { GoogleLoginCookie } from './presentation/google-login-cookie';
import { LoginController } from './presentation/login.controller';
import { MeController } from './presentation/me.controller';
import { ReferralController } from './presentation/referral.controller';
import { SessionGuard } from './presentation/session.guard';
import { TenantTransactionInterceptor } from './presentation/tenant-transaction.interceptor';

/** Contexto Acesso: sessão, login, papéis e convites de acesso. */
@Module({
  controllers: [
    AuthController,
    LoginController,
    GoogleLoginController,
    MeController,
    ReferralController,
  ],
  providers: [
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: SESSION_TOKENS, useClass: OpaqueSessionTokens },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
    { provide: MEMBERSHIP_READER, useClass: PrismaMembershipReader },
    WeddingAuthorization,
    { provide: LOGIN_CHALLENGE_STORE, useClass: PrismaLoginChallengeStore },
    {
      provide: LOGIN_CHALLENGE_SECRETS,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new HmacLoginChallengeSecrets({ codeKeyBase64: config.get({ key: 'LOGIN_CODE_KEY' }) }),
    },
    { provide: LOGIN_CODE_MAILER, useClass: OutboxLoginCodeMailer },
    { provide: USER_ACCOUNTS, useClass: PrismaUserAccounts },
    { provide: PROFILE_DIRECTORY, useClass: PrismaProfileDirectory },
    { provide: REFERRAL_DIRECTORY, useClass: PrismaReferralDirectory },
    {
      provide: GOOGLE_IDENTITY_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        config.get({ key: 'GOOGLE_PROVIDER' }) === 'dev'
          ? new DevGoogleProvider({ appEnv: config.get({ key: 'APP_ENV' }) })
          : new GoogleOidcProvider({
              clientId: config.get({ key: 'GOOGLE_CLIENT_ID' }) ?? '',
              clientSecret: config.get({ key: 'GOOGLE_CLIENT_SECRET' }) ?? '',
              redirectUri: config.get({ key: 'GOOGLE_REDIRECT_URI' }) ?? '',
            }),
    },
    {
      provide: GoogleLoginCookie,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new GoogleLoginCookie({ keyBase64: config.get({ key: 'OAUTH_STATE_KEY' }) }),
    },
    CompleteLogin,
    StartGoogleLogin,
    CompleteGoogleLogin,
    RequestLoginChallenge,
    VerifyLoginChallenge,
    AuthenticateSession,
    StartSession,
    EndSession,
    EndAllSessions,
    GetMe,
    GetReferral,
  ],
  exports: [StartSession, WeddingAuthorization],
})
export class AccessModule {}
