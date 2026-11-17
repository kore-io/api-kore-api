import { SUPPORT_SESSION_STORE } from './application/ports/support-session.store.port';
import { PrismaSupportSessionStore } from './infrastructure/backoffice/prisma-support-session.store';
import { SupportContextInterceptor } from './presentation/http/interceptors/support-context.interceptor';
import { SupportSessionGuard } from './presentation/http/guards/support-session.guard';
import { ReferralModule } from '@/modules/referral/referral.module';
import { IDENTITY_DIRECTORY } from './application/ports/identity-directory.port';
import { PrismaIdentityDirectory } from './infrastructure/persistence/prisma-identity-directory';
import { SendAccessEmailChanged } from './application/invitations/send-access-email-changed.use-case';
import { Module } from '@nestjs/common';
import { AppConfigService } from '@/shared/config/app-config.service';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthenticateSession } from './application/sessions/authenticate-session.use-case';
import { WEDDING_WRITE_STATE } from './application/ports/wedding-write-state.port';
import { PrismaWeddingWriteState } from './infrastructure/backoffice/prisma-wedding-write-state';
import { WeddingWriteGuard } from './presentation/http/guards/wedding-write.guard';
import { CompleteGoogleLogin } from './application/login/complete-google-login.use-case';
import { CompleteLogin } from './application/login/complete-login.use-case';
import { GOOGLE_IDENTITY_PROVIDER } from './application/ports/google-identity-provider.port';
import { StartGoogleLogin } from './application/login/start-google-login.use-case';
import { MEMBERSHIP_READER } from './application/ports/membership-reader.port';
import { WeddingAuthorization } from './application/services/wedding-authorization.service';
import { LOGIN_CHALLENGE_SECRETS } from './application/ports/login-challenge-secrets.port';
import { LOGIN_CHALLENGE_STORE } from './application/ports/login-challenge-store.port';
import { LOGIN_CODE_MAILER } from './application/ports/login-code-mailer.port';
import { REFERRAL_DIRECTORY } from './application/ports/referral-directory.port';
import { GetReferral } from './application/profiles/get-referral.use-case';
import { CheckSlugAvailability } from './application/weddings/check-slug-availability.use-case';
import { CreateWedding } from './application/weddings/create-wedding.use-case';
import { SuggestSlug } from './application/weddings/suggest-slug.service';
import { SLUG_REGISTRY } from './application/ports/slug-registry.port';
import { TERMS_VERSION } from './application/ports/terms-version.port';
import { ACCESS_INVITATION_STORE } from './application/ports/access-invitation-store.port';
import { INVITATION_MAILER } from './application/ports/invitation-mailer.port';
import { INVITATION_TOKENS } from './application/ports/invitation-tokens.port';
import { SendAccessInvitations } from './application/invitations/send-access-invitations.use-case';
import { CancelAccessInvitation } from './application/invitations/cancel-access-invitation.use-case';
import { GetAccessInvitation } from './application/invitations/get-access-invitation.use-case';
import { AcceptAccessInvitation } from './application/invitations/accept-access-invitation.use-case';
import { DeclineAccessInvitation } from './application/invitations/decline-access-invitation.use-case';
import { INVITATION_ACCEPTANCE_STORE } from './application/ports/invitation-acceptance-store.port';
import { PLANNER_PROFILES } from './application/ports/planner-profiles.port';
import { USER_ACCOUNT_NAMES } from './application/ports/user-account-names.port';
import { COLLABORATION_NOTICE_MAILER } from './application/ports/collaboration-notice-mailer.port';
import { DECLINE_NOTICE_MAILER } from './application/ports/decline-notice-mailer.port';
import { WEDDING_SIGNUP_STORE } from './application/ports/wedding-signup-store.port';
import { PROFILE_DIRECTORY } from './application/ports/profile-directory.port';
import { USER_ACCOUNTS } from './application/ports/user-accounts.port';
import { RequestLoginChallenge } from './application/login/request-login-challenge.use-case';
import { ipHasherProvider } from '@/modules/logs/infrastructure/providers/ip-hasher.provider';
import { LOGIN_ABUSE_MONITOR } from './application/ports/login-abuse-monitor.port';
import { PrismaLoginAbuseMonitor } from './infrastructure/backoffice/prisma-login-abuse-monitor';
import { VerifyLoginChallenge } from './application/login/verify-login-challenge.use-case';
import { EndAllSessions } from './application/sessions/end-all-sessions.use-case';
import { EndSession } from './application/sessions/end-session.use-case';
import { GetMe } from './application/sessions/get-me.use-case';
import { DeleteWeddingByCreator } from './application/weddings/delete-wedding-by-creator.use-case';
import { CREATOR_WEDDING_DELETER } from './application/ports/creator-wedding-deletion.port';
import { PrismaCreatorWeddingDeleter } from './infrastructure/backoffice/prisma-creator-wedding-deleter';
import { CreatePlannerWedding } from './application/weddings/create-planner-wedding.use-case';
import { PlannerWeddingRateLimitGuard } from '@/shared/rate-limit/user-rate-limit.guard';
import {
  CreatePlannerProfile,
  GetMyReferrer,
  GetPlannerProfile,
  UpdatePlannerProfile,
} from './application/profiles/planner-profile.use-cases';
import { SetActiveProfile } from './application/sessions/set-active-profile.use-case';
import { ListWeddingMembers } from './application/members/list-wedding-members.use-case';
import { RemoveMembership } from './application/members/remove-membership.use-case';
import { WEDDING_MEMBERS_STORE } from './application/ports/wedding-members-store.port';
import { WEDDING_ACTIVITY } from './application/ports/wedding-activity.port';
import { SESSION_REPOSITORY } from './application/ports/session-repository.port';
import { SESSION_TOKENS } from './application/ports/session-token.port';
import { USER_REPOSITORY } from './application/ports/user-repository.port';
import { StartSession } from './application/sessions/start-session.use-case';
import { DevGoogleProvider } from './infrastructure/providers/dev-google.provider';
import { GoogleOidcProvider } from './infrastructure/providers/google-oidc.provider';
import { HmacLoginChallengeSecrets } from './infrastructure/providers/hmac-login-challenge-secrets';
import { OpaqueSessionTokens } from './infrastructure/providers/opaque-session-tokens';
import { PrismaLoginChallengeStore } from './infrastructure/persistence/prisma-login-challenge.store';
import { PrismaMembershipReader } from './infrastructure/persistence/prisma-membership-reader';
import { PrismaReferralDirectory } from './infrastructure/persistence/prisma-referral-directory';
import { PrismaSlugRegistry } from './infrastructure/persistence/prisma-slug-registry';
import { PrismaAccessInvitationStore } from './infrastructure/persistence/prisma-access-invitation.store';
import { OutboxInvitationMailer } from './infrastructure/mail/outbox-invitation-mailer';
import { PrismaInvitationAcceptanceStore } from './infrastructure/persistence/prisma-invitation-acceptance.store';
import { PrismaPlannerProfiles } from './infrastructure/persistence/prisma-planner-profiles';
import { PrismaWeddingMembersStore } from './infrastructure/persistence/prisma-wedding-members.store';
import { PrismaWeddingActivity } from './infrastructure/persistence/prisma-wedding-activity';
import { PrismaUserAccountNames } from './infrastructure/persistence/prisma-user-account-names';
import { OutboxCollaborationNoticeMailer } from './infrastructure/mail/outbox-collaboration-notice-mailer';
import { OutboxDeclineNoticeMailer } from './infrastructure/mail/outbox-decline-notice-mailer';
import { PrismaWeddingSignupStore } from './infrastructure/persistence/prisma-wedding-signup.store';
import { PrismaProfileDirectory } from './infrastructure/persistence/prisma-profile-directory';
import { PrismaUserAccounts } from './infrastructure/persistence/prisma-user-accounts';
import { OutboxLoginCodeMailer } from './infrastructure/mail/outbox-login-code-mailer';
import { PrismaSessionRepository } from './infrastructure/persistence/prisma-session.repository';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user.repository';
import { AuthController } from './presentation/controllers/auth.controller';
import { GoogleLoginController } from './presentation/controllers/google-login.controller';
import { GoogleLoginCookie } from './presentation/http/cookies/google-login-cookie';
import { LoginController } from './presentation/controllers/login.controller';
import { MeController } from './presentation/controllers/me.controller';
import { PlannerController } from './presentation/controllers/planner.controller';
import { ReferralController } from './presentation/controllers/referral.controller';
import { WeddingsController } from './presentation/controllers/weddings.controller';
import { AccessInvitationsController } from './presentation/controllers/access-invitations.controller';
import { InvitationAcceptanceController } from './presentation/controllers/invitation-acceptance.controller';
import { WeddingMembersController } from './presentation/controllers/wedding-members.controller';
import { SessionGuard } from './presentation/http/guards/session.guard';
import { WeddingScope } from './application/services/wedding-scope.service';
import { TenantTransactionInterceptor } from './presentation/http/interceptors/tenant-transaction.interceptor';

/** Contexto Acesso: sessão, login, papéis e convites de acesso. */
@Module({
  // Os dados para receber no GET /v1/me/referrer (Repasse, Contrato).
  imports: [ReferralModule],
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
    { provide: IDENTITY_DIRECTORY, useClass: PrismaIdentityDirectory },
    SendAccessEmailChanged,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: SESSION_TOKENS, useClass: OpaqueSessionTokens },
    { provide: APP_GUARD, useClass: SessionGuard },
    // Ver como o casal (Backoffice - acesso RN08): depois da sessão, antes do
    // guard das escritas e da validação.
    { provide: APP_GUARD, useClass: SupportSessionGuard },
    // Depois da sessão, antes da validação (Casamento bloqueado RN02).
    { provide: APP_GUARD, useClass: WeddingWriteGuard },
    { provide: WEDDING_WRITE_STATE, useClass: PrismaWeddingWriteState },
    // O contexto do Ver como o casal antes da transação da requisição.
    { provide: APP_INTERCEPTOR, useClass: SupportContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
    { provide: SUPPORT_SESSION_STORE, useClass: PrismaSupportSessionStore },
    { provide: MEMBERSHIP_READER, useClass: PrismaMembershipReader },
    WeddingAuthorization,
    WeddingScope,
    { provide: LOGIN_CHALLENGE_STORE, useClass: PrismaLoginChallengeStore },
    { provide: LOGIN_ABUSE_MONITOR, useClass: PrismaLoginAbuseMonitor },
    ipHasherProvider,
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
    { provide: COLLABORATION_NOTICE_MAILER, useClass: OutboxCollaborationNoticeMailer },
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
    DeleteWeddingByCreator,
    { provide: CREATOR_WEDDING_DELETER, useClass: PrismaCreatorWeddingDeleter },
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
  exports: [
    SUPPORT_SESSION_STORE,
    SendAccessEmailChanged,
    StartSession,
    WeddingAuthorization,
    WeddingScope,
    CheckSlugAvailability,
    PLANNER_PROFILES,
    GetMyReferrer,
  ],
})
export class AccessModule {}
