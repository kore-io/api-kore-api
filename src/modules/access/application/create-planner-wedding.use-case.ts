import { Inject, Injectable } from '@nestjs/common';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import type { SiteAppearanceInput } from '../../site/application/update-site-appearance.use-case';
import {
  OwnerlessWeddingsLimitError,
  ProfileNotOwnedError,
  SlugUnavailableError,
} from '../domain/access.errors';
import {
  cleanText,
  isReservedSlug,
  timezoneForState,
  type BrazilianState,
} from '../domain/wedding-signup';
import { checkedAppearance } from './create-wedding.use-case';
import { PLANNER_PROFILES, type PlannerProfiles } from './ports/planner-profiles.port';
import { SLUG_REGISTRY, type SlugRegistry } from './ports/slug-registry.port';
import { WEDDING_SIGNUP_STORE, type WeddingSignupStore } from './ports/wedding-signup-store.port';
import { SuggestSlug } from './suggest-slug.service';

/**
 * Teto técnico de casamentos sem dono por cerimonialista (Novo casamento RN04;
 * decisão 224(9)): não aparece na tela e, na decisão 24, só serve de guarda.
 */
export const OWNERLESS_WEDDINGS_MAX = 50;

export interface PlannerWeddingInput {
  partnerNames: [string, string];
  eventDate: Date | null;
  city: string;
  state: BrazilianState;
  slug: string;
  /** A Aparência do passo 2 (RN03); sem ela, o padrão (Romântico, Terracota, Creme). */
  appearance: SiteAppearanceInput | null;
}

export interface CreatedPlannerWedding {
  weddingId: string;
  slug: string;
  status: 'draft';
  timezone: string;
}

/**
 * Novo casamento pela cerimonialista (POST /v1/me/weddings; RN01 a RN04): o
 * casamento nasce em rascunho, sem dono, com os noivos sem login, ela como
 * colaboradora e a atribuição a ela (`created_by_planner`). Não muda o perfil
 * ativo da sessão. Roda na transação da requisição; as policies da F6 são a
 * segunda barreira.
 */
@Injectable()
export class CreatePlannerWedding {
  constructor(
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
    @Inject(WEDDING_SIGNUP_STORE) private readonly store: WeddingSignupStore,
    @Inject(SLUG_REGISTRY) private readonly slugs: SlugRegistry,
    private readonly suggestSlug: SuggestSlug,
  ) {}

  async execute({
    userId,
    input,
    now,
  }: {
    userId: string;
    input: PlannerWeddingInput;
    now: Date;
  }): Promise<CreatedPlannerWedding> {
    // RN01: ter o perfil (indicador cerimonialista ativo), não estar nele na sessão.
    const profile = await this.profiles.findOwn({ userId });
    if (!profile) throw new ProfileNotOwnedError();
    const appearance = input.appearance && checkedAppearance({ input: input.appearance });

    await this.store.lockPlannerWeddings({ userId });
    if ((await this.store.countOwnerlessCreated()) >= OWNERLESS_WEDDINGS_MAX)
      throw new OwnerlessWeddingsLimitError();

    const slugUnavailable = () =>
      this.suggestSlug
        .execute({ slug: input.slug, eventDate: input.eventDate })
        .then((suggestion) => new SlugUnavailableError({ suggestion }));
    if (isReservedSlug({ slug: input.slug }) || (await this.slugs.isTaken({ slug: input.slug })))
      throw await slugUnavailable();

    const weddingId = uuidV7({ now: now.getTime() });
    const timezone = timezoneForState({ state: input.state });
    const result = await this.store.createForPlanner({
      wedding: {
        weddingId,
        userId,
        referrerId: profile.referrerId,
        partnerNames: [
          cleanText({ value: input.partnerNames[0] }),
          cleanText({ value: input.partnerNames[1] }),
        ],
        slug: input.slug,
        eventDate: input.eventDate,
        city: cleanText({ value: input.city }),
        state: input.state,
        timezone,
        appearance,
        now,
      },
    });
    // Duplo toque ou duas abas (revisão C3-7): o segundo cai no endereço em uso.
    if (result === 'slug_taken') throw await slugUnavailable();
    return { weddingId, slug: input.slug, status: 'draft', timezone };
  }
}
