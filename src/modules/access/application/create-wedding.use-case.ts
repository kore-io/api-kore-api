import { Inject, Injectable } from '@nestjs/common';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import {
  AlreadyOwnerError,
  SlugUnavailableError,
  TermsVersionOutdatedError,
} from '../domain/access.errors';
import { toReferral } from '../domain/referral';
import {
  cleanText,
  RESERVED_SLUGS,
  timezoneForState,
  type BrazilianState,
  type ClientSignupSource,
  type PartnerTitle,
} from '../domain/wedding-signup';
import { REFERRAL_DIRECTORY, type ReferralDirectory } from './ports/referral-directory.port';
import { TERMS_VERSION } from './ports/terms-version.port';
import { SLUG_REGISTRY, type SlugRegistry } from './ports/slug-registry.port';
import { WEDDING_SIGNUP_STORE, type WeddingSignupStore } from './ports/wedding-signup-store.port';
import { SuggestSlug } from './suggest-slug.service';

export interface WeddingSignup {
  myName: string;
  myTitle: PartnerTitle;
  partnerName: string;
  eventDate: Date | null;
  city: string;
  state: BrazilianState;
  slug: string;
  referralCode: string | null;
  termsVersion: string;
  signupSource: ClientSignupSource | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

export interface CreatedWedding {
  weddingId: string;
  slug: string;
  status: 'draft';
  timezone: string;
  referrer: { name: string; discountPercent: number | null } | null;
}

/**
 * Cria o casamento em rascunho com a pessoa como dona e os dois noivos (RN02,
 * RN03, RN06, RN07 de Cadastro), aplica a indicação (RN08, RN09) e grava o
 * aceite dos Termos (RN11; decisão 166). Roda na transação da requisição.
 */
@Injectable()
export class CreateWedding {
  constructor(
    @Inject(WEDDING_SIGNUP_STORE) private readonly store: WeddingSignupStore,
    @Inject(REFERRAL_DIRECTORY) private readonly referrals: ReferralDirectory,
    @Inject(SLUG_REGISTRY) private readonly slugs: SlugRegistry,
    private readonly suggestSlug: SuggestSlug,
    @Inject(TERMS_VERSION) private readonly currentTermsVersion: string,
  ) {}

  async execute({
    userId,
    signup,
    now,
  }: {
    userId: string;
    signup: WeddingSignup;
    now: Date;
  }): Promise<CreatedWedding> {
    if (signup.termsVersion !== this.currentTermsVersion) throw new TermsVersionOutdatedError();

    await this.store.lockOwner({ userId });
    const ownedWeddingId = await this.store.findActiveOwnedWeddingId({ userId });
    if (ownedWeddingId) throw new AlreadyOwnerError({ weddingId: ownedWeddingId });

    const slugUnavailable = () =>
      this.suggestSlug
        .execute({ slug: signup.slug, eventDate: signup.eventDate })
        .then((suggestion) => new SlugUnavailableError({ suggestion }));
    if (RESERVED_SLUGS.has(signup.slug) || (await this.slugs.isTaken({ slug: signup.slug })))
      throw await slugUnavailable();

    const attribution = await this.attribution({ userId, referralCode: signup.referralCode });
    const weddingId = uuidV7({ now: now.getTime() });
    const timezone = timezoneForState({ state: signup.state });
    const result = await this.store.create({
      wedding: {
        weddingId,
        userId,
        myName: cleanText({ value: signup.myName }),
        myTitle: signup.myTitle,
        partnerName: cleanText({ value: signup.partnerName }),
        slug: signup.slug,
        eventDate: signup.eventDate,
        city: cleanText({ value: signup.city }),
        state: signup.state,
        timezone,
        referrerId: attribution?.referrerId ?? null,
        // Indicação válida vale mais que a origem informada (decisões 135 e 166).
        signupSource: attribution ? 'referral_link' : (signup.signupSource ?? 'direct'),
        utmSource: signup.utmSource,
        utmMedium: signup.utmMedium,
        utmCampaign: signup.utmCampaign,
        termsVersion: signup.termsVersion,
        now,
      },
    });
    // Corrida no UNIQUE do endereço: quem perde vê o erro da RN05 (caso de borda).
    if (result === 'slug_taken') throw await slugUnavailable();

    return {
      weddingId,
      slug: signup.slug,
      status: 'draft',
      timezone,
      referrer: attribution && {
        name: attribution.name,
        discountPercent: attribution.discountPercent,
      },
    };
  }

  /** RN08: indicador ativo atribui, menos o próprio indicador; o resto segue sem indicação. */
  private async attribution({
    userId,
    referralCode,
  }: {
    userId: string;
    referralCode: string | null;
  }): Promise<{ referrerId: string; name: string; discountPercent: number | null } | null> {
    if (!referralCode) return null;
    const referrer = await this.referrals.findByCode({ code: referralCode });
    if (!referrer || referrer.userId === userId) return null;
    const referral = toReferral({
      referrer,
      referralDiscountPercent: await this.referrals.referralDiscountPercent(),
    });
    if (!referral) return null;
    return {
      referrerId: referrer.referrerId,
      name: referral.referrerName,
      discountPercent: referral.discountPercent,
    };
  }
}
