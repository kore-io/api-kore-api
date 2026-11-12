import {
  AlreadyOwnerError,
  SlugUnavailableError,
  TermsVersionOutdatedError,
} from '../domain/access.errors';
import type { ReferrerRecord } from '../domain/referral';
import { CreateWedding, type WeddingSignup } from './create-wedding.use-case';
import type { ReferralDirectory } from './ports/referral-directory.port';
import type { SlugRegistry } from './ports/slug-registry.port';
import type { NewWedding, WeddingSignupStore } from './ports/wedding-signup-store.port';
import { SuggestSlug } from './suggest-slug.service';

const juliana: ReferrerRecord = {
  referrerId: 'r-juliana',
  userId: 'u-juliana',
  referralCode: 'juliana-prado',
  kind: 'planner',
  status: 'active',
  accountStatus: 'active',
  displayName: 'Juliana Prado',
  referralDiscountEnabled: true,
};

const signup: WeddingSignup = {
  myName: '  Ana  Beatriz Moreira ',
  myTitle: 'bride',
  partnerName: 'Marcos Vinícius Rocha',
  eventDate: new Date('2026-11-14T00:00:00Z'),
  city: ' Campinas ',
  state: 'MT',
  slug: 'ana-e-marcos',
  referralCode: null,
  termsVersion: '2026-09',
  signupSource: null,
  utmSource: 'instagram',
  utmMedium: null,
  utmCampaign: null,
  appearance: null,
};

function setup({
  ownedWeddingId = null,
  taken = [],
  referrer = null,
  createResult = 'created',
}: {
  ownedWeddingId?: string | null;
  taken?: string[];
  referrer?: ReferrerRecord | null;
  createResult?: 'created' | 'slug_taken';
} = {}) {
  const created: NewWedding[] = [];
  const store: WeddingSignupStore = {
    lockOwner: jest.fn().mockResolvedValue(undefined),
    findActiveOwnedWeddingId: jest.fn().mockResolvedValue(ownedWeddingId),
    create: jest.fn(({ wedding }: { wedding: NewWedding }) => {
      created.push(wedding);
      return Promise.resolve(createResult);
    }),
  };
  const referrals: ReferralDirectory = {
    findByCode: jest.fn().mockResolvedValue(referrer),
    referralDiscountPercent: jest.fn().mockResolvedValue(10),
  };
  const slugs: SlugRegistry = {
    isTaken: ({ slug }) => Promise.resolve(taken.includes(slug)),
    currentSlugOf: () => Promise.resolve(null),
  };
  const useCase = new CreateWedding(store, referrals, slugs, new SuggestSlug(slugs), '2026-09');
  return { useCase, store, created };
}

const now = new Date('2026-11-06T12:00:00Z');

describe('CreateWedding (POST /v1/weddings)', () => {
  it('RN03 e RN07 - cria em rascunho, com o fuso da UF, nomes aparados e origem direct', async () => {
    const { useCase, created } = setup();

    const result = await useCase.execute({ userId: 'u-ana', sessionId: 's-ana', signup, now });

    expect(result).toMatchObject({
      slug: 'ana-e-marcos',
      status: 'draft',
      timezone: 'America/Cuiaba',
      referrer: null,
    });
    expect(created[0]).toMatchObject({
      weddingId: result.weddingId,
      userId: 'u-ana',
      sessionId: 's-ana',
      myName: 'Ana Beatriz Moreira',
      city: 'Campinas',
      referrerId: null,
      signupSource: 'direct',
      utmSource: 'instagram',
      termsVersion: '2026-09',
      now,
    });
  });

  it('Simule RN10 - a aparência do simulador grava em maiúsculas; a paleta só fica com as cores dela; sem ela, nula', async () => {
    const { useCase, created } = setup();

    await useCase.execute({
      userId: 'u-ana',
      sessionId: 's-ana',
      signup: {
        ...signup,
        signupSource: 'simulator',
        appearance: {
          fontPairKey: 'leve',
          starterPaletteKey: 'salvia',
          primaryColor: '#566c4b',
          accentColor: '#c9a66b',
          backgroundMode: 'light',
        },
      },
      now,
    });
    await useCase.execute({
      userId: 'u-ana',
      sessionId: 's-ana',
      signup: {
        ...signup,
        appearance: {
          fontPairKey: 'romantico',
          starterPaletteKey: 'terracota',
          primaryColor: '#1F2A44',
          accentColor: '#7A8B69',
          backgroundMode: 'cream',
        },
      },
      now,
    });
    await useCase.execute({ userId: 'u-ana', sessionId: 's-ana', signup, now });

    expect(created[0]).toMatchObject({
      signupSource: 'simulator',
      appearance: {
        fontPairKey: 'leve',
        starterPaletteKey: 'salvia',
        primaryColor: '#566C4B',
        accentColor: '#C9A66B',
        backgroundMode: 'light',
      },
    });
    // Outra cor: só a primária muda, e a paleta vira "cor própria" (decisão 205, D22).
    expect(created[1].appearance).toMatchObject({
      starterPaletteKey: null,
      primaryColor: '#1F2A44',
    });
    expect(created[2].appearance).toBeNull();
  });

  it('Simule RN10 - a aparência adulterada que não passa no guarda-corpo é recusada (422), sem gravar', async () => {
    const { useCase, store } = setup();

    await expect(
      useCase.execute({
        userId: 'u-ana',
        sessionId: 's-ana',
        signup: {
          ...signup,
          appearance: {
            fontPairKey: 'romantico',
            starterPaletteKey: null,
            primaryColor: '#777777',
            accentColor: '#7A8B69',
            backgroundMode: 'light',
          },
        },
        now,
      }),
    ).rejects.toMatchObject({ check: 'primary_foreground', ratio: 4.47 });
    expect(store.create).not.toHaveBeenCalled();
  });

  it('RN11 - dada outra versão dos Termos, então TERMS_VERSION_OUTDATED, sem gravar (decisão 166)', async () => {
    const { useCase, store } = setup();

    await expect(
      useCase.execute({
        userId: 'u-ana',
        sessionId: 's-ana',
        signup: { ...signup, termsVersion: '2025-01' },
        now,
      }),
    ).rejects.toThrow(TermsVersionOutdatedError);
    expect(store.create).not.toHaveBeenCalled();
  });

  it('RN06 - dada uma pessoa que já é dona de um casamento ativo, então ALREADY_OWNER com o casamento', async () => {
    const { useCase, store } = setup({ ownedWeddingId: 'w-existente' });

    await expect(
      useCase.execute({ userId: 'u-ana', sessionId: 's-ana', signup, now }),
    ).rejects.toMatchObject(new AlreadyOwnerError({ weddingId: 'w-existente' }));
    expect(store.lockOwner).toHaveBeenCalledWith({ userId: 'u-ana' });
    expect(store.create).not.toHaveBeenCalled();
  });

  it('RN05 - dado um endereço em uso, então SLUG_UNAVAILABLE com a sugestão', async () => {
    const { useCase } = setup({ taken: ['ana-e-marcos'] });

    await expect(
      useCase.execute({ userId: 'u-ana', sessionId: 's-ana', signup, now }),
    ).rejects.toMatchObject({
      name: 'SlugUnavailableError',
      suggestion: 'ana-e-marcos-2026',
    });
  });

  it('RN05 - dada uma palavra reservada, então SLUG_UNAVAILABLE', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({
        userId: 'u-ana',
        sessionId: 's-ana',
        signup: { ...signup, slug: 'entrar' },
        now,
      }),
    ).rejects.toThrow(SlugUnavailableError);
  });

  it('RN05 - dada a corrida no UNIQUE do endereço, então quem perde vê o erro com sugestão', async () => {
    const { useCase } = setup({ createResult: 'slug_taken' });

    await expect(
      useCase.execute({ userId: 'u-ana', sessionId: 's-ana', signup, now }),
    ).rejects.toThrow(SlugUnavailableError);
  });

  it('RN08 e RN09 - dado o link de um indicador ativo, então atribui, devolve o desconto e a origem vira referral_link', async () => {
    const { useCase, created } = setup({ referrer: juliana });

    const result = await useCase.execute({
      userId: 'u-ana',
      sessionId: 's-ana',
      signup: { ...signup, referralCode: 'juliana-prado', signupSource: 'simulator' },
      now,
    });

    expect(result.referrer).toEqual({ name: 'Juliana Prado', discountPercent: 10 });
    expect(created[0]).toMatchObject({ referrerId: 'r-juliana', signupSource: 'referral_link' });
  });

  it('RN09 - dado o desconto do indicador desligado, então atribui sem desconto', async () => {
    const { useCase } = setup({ referrer: { ...juliana, referralDiscountEnabled: false } });

    const result = await useCase.execute({
      userId: 'u-ana',
      sessionId: 's-ana',
      signup: { ...signup, referralCode: 'juliana-prado' },
      now,
    });

    expect(result.referrer).toEqual({ name: 'Juliana Prado', discountPercent: null });
  });

  it.each([
    ['o próprio indicador', juliana, 'u-juliana'],
    ['indicador inativo', { ...juliana, status: 'inactive' as const }, 'u-ana'],
    ['código inexistente', null, 'u-ana'],
  ])(
    'RN08 - dado %s, então cria sem atribuição e com a origem do cliente',
    async (_, referrer, userId) => {
      const { useCase, created } = setup({ referrer });

      const result = await useCase.execute({
        userId,
        sessionId: 's1',
        signup: { ...signup, referralCode: 'juliana-prado', signupSource: 'made_with_kore' },
        now,
      });

      expect(result.referrer).toBeNull();
      expect(created[0]).toMatchObject({ referrerId: null, signupSource: 'made_with_kore' });
    },
  );
});
