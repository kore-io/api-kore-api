import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import {
  PlannerNotFoundError,
  PlannerProfileExistsError,
  PlannerProfileInvalidError,
  PlannerSignupDisabledError,
  ProfileNotOwnedError,
  SellerCannotBePlannerError,
  SessionExpiredError,
  TermsVersionOutdatedError,
} from '../domain/access.errors';
import type { AuthenticatedSession } from '../domain/authenticated-session';
import {
  checkPlannerProfile,
  isProfileComplete,
  type PlannerProfileInput,
} from '../domain/planner-profile';
import { homeFor } from '../domain/profiles';
import {
  PLANNER_PROFILES,
  type PlannerProfileRecord,
  type PlannerProfiles,
} from './ports/planner-profiles.port';
import { REFERRAL_DIRECTORY, type ReferralDirectory } from './ports/referral-directory.port';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session-repository.port';
import { TERMS_VERSION } from './ports/terms-version.port';
import { USER_REPOSITORY, type UserRepository } from './ports/user-repository.port';

/** GET /v1/me/planner (Cadastro e perfil RN09 e RN10; Assinatura RN06). */
export interface PlannerProfileView {
  email: string;
  name: string | null;
  creditName: string;
  phone: string | null;
  whatsapp: string | null;
  cities: string[];
  profileComplete: boolean;
  termsAccepted: boolean;
  creditHidden: boolean;
}

function toView({
  profile,
  currentTermsVersion,
}: {
  profile: PlannerProfileRecord;
  currentTermsVersion: string;
}): PlannerProfileView {
  const termsAccepted = profile.user.termsVersion === currentTermsVersion;
  return {
    email: profile.user.email,
    name: profile.user.name,
    creditName: profile.creditName,
    phone: profile.phone,
    whatsapp: profile.whatsapp,
    cities: profile.cities,
    profileComplete: isProfileComplete({
      creditName: profile.creditName,
      cities: profile.cities,
      termsAccepted,
    }),
    termsAccepted,
    creditHidden: profile.creditHidden,
  };
}

/**
 * Cria o perfil de cerimonialista pela página de parceria (POST /v1/me/planner;
 * Cadastro e perfil RN02 a RN05). Na transação da requisição: Referrer,
 * Planner, Organization, o nome e os Termos da conta, a sessão em planner e o
 * log valem juntos.
 */
@Injectable()
export class CreatePlannerProfile {
  constructor(
    private readonly config: AppConfigService,
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
    @Inject(TERMS_VERSION) private readonly currentTermsVersion: string,
  ) {}

  async execute({
    session,
    input,
    termsVersion,
    now,
  }: {
    session: AuthenticatedSession;
    input: PlannerProfileInput;
    termsVersion: string;
    now: Date;
  }): Promise<{ referralCode: string; home: string }> {
    if (!this.config.get({ key: 'PLANNER_SIGNUP_ENABLED' })) throw new PlannerSignupDisabledError();
    const { userId } = session;
    const user = await this.users.findProfileById({ userId });
    if (!user) throw new SessionExpiredError();

    const kind = await this.profiles.referrerKind({ userId });
    if (kind === 'planner') throw new PlannerProfileExistsError();
    if (kind === 'seller') throw new SellerCannotBePlannerError();

    // O nome da pessoa só é pedido quando a conta não tem (RN04).
    const { changes, issues } = checkPlannerProfile({
      input: user.name ? { ...input, name: undefined } : input,
      required: user.name ? ['creditName', 'cities'] : ['creditName', 'name', 'cities'],
    });
    if (issues.length > 0) throw new PlannerProfileInvalidError({ issues });
    if (termsVersion !== this.currentTermsVersion) throw new TermsVersionOutdatedError();

    const personName = user.name ?? changes.name ?? '';
    const created = await this.profiles.create({
      userId,
      profile: {
        codeName: personName,
        creditName: changes.creditName ?? '',
        phone: changes.phone ?? null,
        whatsapp: changes.whatsapp ?? null,
        cities: changes.cities ?? [],
      },
      now,
    });
    await this.profiles.updateAccount({
      userId,
      name: user.name ? null : personName,
      termsVersion,
      now,
    });
    await this.sessions.setActiveProfile({
      sessionId: session.sessionId,
      userId,
      profile: 'planner',
    });
    await this.log.record({
      entry: {
        action: 'planner.created',
        actorKind: 'user',
        actorUserId: userId,
        entityType: 'referrer',
        entityId: created.referrerId,
        data: { referrerId: created.referrerId },
      },
    });
    return { referralCode: created.referralCode, home: homeFor({ profile: 'planner' }) };
  }
}

/** Meu perfil (GET /v1/me/planner; RN09 e RN10). */
@Injectable()
export class GetPlannerProfile {
  constructor(
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
    @Inject(TERMS_VERSION) private readonly currentTermsVersion: string,
  ) {}

  async execute({ userId }: { userId: string }): Promise<PlannerProfileView> {
    const profile = await this.profiles.findOwn({ userId });
    if (!profile) throw new PlannerNotFoundError();
    return toView({ profile, currentTermsVersion: this.currentTermsVersion });
  }
}

/**
 * Salva o Meu perfil (PATCH /v1/me/planner; RN09 e RN10): as validações do
 * cadastro, os Termos quando faltam, a assessoria com o nome novo e o log da
 * mudança do nome da assinatura (decisão 223, risco 2).
 */
@Injectable()
export class UpdatePlannerProfile {
  constructor(
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
    @Inject(TERMS_VERSION) private readonly currentTermsVersion: string,
  ) {}

  async execute({
    userId,
    input,
    termsVersion,
    now,
  }: {
    userId: string;
    input: PlannerProfileInput;
    termsVersion: string | null;
    now: Date;
  }): Promise<PlannerProfileView> {
    const profile = await this.profiles.findOwn({ userId });
    if (!profile) throw new PlannerNotFoundError();

    const { changes, issues } = checkPlannerProfile({ input, required: [] });
    const termsAccepted = profile.user.termsVersion === this.currentTermsVersion;
    // RN10: sem os Termos vigentes, o Meu perfil só salva com a caixa marcada.
    if (!termsAccepted && !termsVersion)
      issues.push({ path: 'termsVersion', code: 'REQUIRED', params: {} });
    if (issues.length > 0) throw new PlannerProfileInvalidError({ issues });
    if (termsVersion && termsVersion !== this.currentTermsVersion)
      throw new TermsVersionOutdatedError();

    const { name, ...plannerChanges } = changes;
    await this.profiles.update({ userId, referrerId: profile.referrerId, changes: plannerChanges });
    await this.profiles.updateAccount({
      userId,
      name: name ?? null,
      termsVersion: termsAccepted ? null : termsVersion,
      now,
    });
    if (plannerChanges.creditName !== undefined && plannerChanges.creditName !== profile.creditName)
      await this.log.record({
        entry: {
          action: 'planner.credit_name_changed',
          actorKind: 'user',
          actorUserId: userId,
          entityType: 'referrer',
          entityId: profile.referrerId,
          data: { from: profile.creditName, to: plannerChanges.creditName },
        },
      });

    const saved = await this.profiles.findOwn({ userId });
    if (!saved) throw new PlannerNotFoundError();
    return toView({ profile: saved, currentTermsVersion: this.currentTermsVersion });
  }
}

/** GET /v1/me/referrer (Link de indicação RN01 e RN02; sem o ratePercent, D4). */
@Injectable()
export class GetMyReferrer {
  constructor(
    private readonly config: AppConfigService,
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
    @Inject(REFERRAL_DIRECTORY) private readonly referrals: ReferralDirectory,
  ) {}

  async execute({
    userId,
  }: {
    userId: string;
  }): Promise<{ referralCode: string; link: string; discountPercent: number | null }> {
    const profile = await this.profiles.findOwn({ userId });
    // Rota da cerimonialista: sem o perfil, o código que já existe (decisão 224(3)).
    if (!profile) throw new ProfileNotOwnedError();
    const base = this.config.get({ key: 'REFERRAL_LINK_URL' }).replace(/\/+$/, '');
    return {
      referralCode: profile.referralCode,
      link: `${base}/${encodeURIComponent(profile.referralCode)}`,
      // Com o desconto desligado, o aviso não aparece (Novo casamento RN05).
      discountPercent: profile.referralDiscountEnabled
        ? await this.referrals.referralDiscountPercent()
        : null,
    };
  }
}
