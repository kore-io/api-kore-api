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
import { CheckSlugAvailability } from './application/check-slug-availability.use-case';
import { CreateWedding } from './application/create-wedding.use-case';
import { SuggestSlug } from './application/suggest-slug.service';
import { SLUG_REGISTRY } from './application/ports/slug-registry.port';
import { TERMS_VERSION } from './application/ports/terms-version.port';
import { ACCESS_INVITATION_STORE } from './application/ports/access-invitation-store.port';
import { INVITATION_MAILER } from './application/ports/invitation-mailer.port';
import { INVITATION_TOKENS } from './application/ports/invitation-tokens.port';
import { SendAccessInvitations } from './application/send-access-invitations.use-case';
import { CancelAccessInvitation } from './application/cancel-access-invitation.use-case';
import { GetAccessInvitation } from './application/get-access-invitation.use-case';
import { AcceptAccessInvitation } from './application/accept-access-invitation.use-case';
import { DeclineAccessInvitation } from './application/decline-access-invitation.use-case';
import { INVITATION_ACCEPTANCE_STORE } from './application/ports/invitation-acceptance-store.port';
import { PLANNER_PROFILES } from './application/ports/planner-profiles.port';
import { USER_ACCOUNT_NAMES } from './application/ports/user-account-names.port';
import { DECLINE_NOTICE_MAILER } from './application/ports/decline-notice-mailer.port';
import { WEDDING_SIGNUP_STORE } from './application/ports/wedding-signup-store.port';
import { PROFILE_DIRECTORY } from './application/ports/profile-directory.port';
import { USER_ACCOUNTS } from './application/ports/user-accounts.port';
import { RequestLoginChallenge } from './application/request-login-challenge.use-case';
import { VerifyLoginChallenge } from './application/verify-login-challenge.use-case';
import { EndAllSessions } from './application/end-all-sessions.use-case';
import { EndSession } from './application/end-session.use-case';
import { GetMe } from './application/get-me.use-case';
import { CreatePlannerWedding } from './application/create-planner-wedding.use-case';
import { PlannerWeddingRateLimitGuard } from '../../shared/rate-limit/user-rate-limit.guard';
import {
  CreatePlannerProfile,
  GetMyReferrer,
  GetPlannerProfile,
  UpdatePlannerProfile,
} from './application/planner-profile.use-cases';
import { SetActiveProfile } from './application/set-active-profile.use-case';
import { ListWeddingMembers } from './application/list-wedding-members.use-case';
import { RemoveMembership } from './application/remove-membership.use-case';
import { WEDDING_MEMBERS_STORE } from './application/ports/wedding-members-store.port';
import { WEDDING_ACTIVITY } from './application/ports/wedding-activity.port';
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
import { PrismaSlugRegistry } from './infrastructure/prisma-slug-registry';
import { PrismaAccessInvitationStore } from './infrastructure/prisma-access-invitation.store';
import { OutboxInvitationMailer } from './infrastructure/outbox-invitation-mailer';
import { PrismaInvitationAcceptanceStore } from './infrastructure/prisma-invitation-acceptance.store';
import { PrismaPlannerProfiles } from './infrastructure/prisma-planner-profiles';
import { PrismaWeddingMembersStore } from './infrastructure/prisma-wedding-members.store';
import { PrismaWeddingActivity } from './infrastructure/prisma-wedding-activity';
import { PrismaUserAccountNames } from './infrastructure/prisma-user-account-names';
import { OutboxDeclineNoticeMailer } from './infrastructure/outbox-decline-notice-mailer';
import { PrismaWeddingSignupStore } from './infrastructure/prisma-wedding-signup.store';
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
import { PlannerController } from './presentation/planner.controller';
import { ReferralController } from './presentation/referral.controller';
import { WeddingsController } from './presentation/weddings.controller';
import { AccessInvitationsController } from './presentation/access-invitations.controller';
import { InvitationAcceptanceController } from './presentation/invitation-acceptance.controller';
import { WeddingMembersController } from './presentation/wedding-members.controller';
import { SessionGuard } from './presentation/session.guard';
import { WeddingScope } from './application/wedding-scope.service';
import { TenantTransactionInterceptor } from './presentation/tenant-transaction.interceptor';

/** Contexto Acesso: sessão, login, papéis e convites de acesso. */
@Module({
  controllers: [
    AuthController,
    LoginController,
    GoogleLoginController,
    MeController,
    PlannerController,
    ReferralController,
    WeddingsController,
    AccessInvitationsController,
    InvitationAcceptanceController,
    WeddingMembersController,
  ],
  providers: [
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: SESSION_TOKENS, useClass: OpaqueSessionTokens },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
    { provide: MEMBERSHIP_READER, useClass: PrismaMembershipReader },
    WeddingAuthorization,
    WeddingScope,
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
    { provide: SLUG_REGISTRY, useClass: PrismaSlugRegistry },
    { provide: WEDDING_SIGNUP_STORE, useClass: PrismaWeddingSignupStore },
    { provide: ACCESS_INVITATION_STORE, useClass: PrismaAccessInvitationStore },
    { provide: INVITATION_MAILER, useClass: OutboxInvitationMailer },
    { provide: INVITATION_ACCEPTANCE_STORE, useClass: PrismaInvitationAcceptanceStore },
    { provide: PLANNER_PROFILES, useClass: PrismaPlannerProfiles },
    { provide: WEDDING_MEMBERS_STORE, useClass: PrismaWeddingMembersStore },
    { provide: WEDDING_ACTIVITY, useClass: PrismaWeddingActivity },
    { provide: USER_ACCOUNT_NAMES, useClass: PrismaUserAccountNames },
    { provide: DECLINE_NOTICE_MAILER, useClass: OutboxDeclineNoticeMailer },
    // Mesmo gerador opaco da sessão: 256 bits, SHA-256 no banco.
    { provide: INVITATION_TOKENS, useClass: OpaqueSessionTokens },
    {
      provide: TERMS_VERSION,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => config.get({ key: 'TERMS_VERSION' }),
    },
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
    SetActiveProfile,
    CreatePlannerProfile,
    GetPlannerProfile,
    UpdatePlannerProfile,
    GetMyReferrer,
    CreatePlannerWedding,
    PlannerWeddingRateLimitGuard,
    ListWeddingMembers,
    RemoveMembership,
    GetReferral,
    SuggestSlug,
    CheckSlugAvailability,
    CreateWedding,
    SendAccessInvitations,
    CancelAccessInvitation,
    GetAccessInvitation,
    AcceptAccessInvitation,
    DeclineAccessInvitation,
  ],
  exports: [StartSession, WeddingAuthorization, WeddingScope, CheckSlugAvailability],
})
export class AccessModule {}
