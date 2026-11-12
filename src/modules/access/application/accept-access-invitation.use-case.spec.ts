import type { ProductEventRecorder } from '../../product-events/application/ports/product-event-recorder.port';
import {
  AcceptanceDetailsMissingError,
  AlreadyOwnerError,
  EmailMismatchError,
  InvitationInvalidError,
  SelfReferralError,
  SellerCannotBePlannerError,
} from '../domain/access.errors';
import type { InvitationSnapshot } from '../domain/invitation-acceptance';
import {
  AcceptAccessInvitation,
  type InvitationAcceptance,
} from './accept-access-invitation.use-case';
import type { InvitationAcceptanceStore } from './ports/invitation-acceptance-store.port';
import type { PlannerProfiles } from './ports/planner-profiles.port';
import type { SessionRepository } from './ports/session-repository.port';
import type { UserAccountNames } from './ports/user-account-names.port';
import type { UserRepository } from './ports/user-repository.port';
import type { WeddingSignupStore } from './ports/wedding-signup-store.port';

const now = new Date('2026-11-10T00:00:00Z');
const coupleLink: InvitationSnapshot = {
  id: 'i1',
  weddingId: 'w1',
  kind: 'couple',
  email: null,
  role: 'owner',
  expiresAt: new Date('2026-12-01T00:00:00Z'),
  acceptedAt: null,
  declinedAt: null,
  revokedAt: null,
  supersededAt: null,
  wedding: {
    status: 'awaiting_couple',
    eventDate: null,
    city: 'Valinhos',
    state: 'SP',
    createdByUserId: 'u-lucas',
    referralSource: 'created_by_seller',
    partners: [
      { slot: 1, displayName: 'Fernanda', title: null, userId: null },
      { slot: 2, displayName: 'João', title: null, userId: null },
    ],
    activeOwners: 0,
    activeCollaborators: 1,
  },
  inviter: {
    userId: 'u-lucas',
    email: 'l@x.com',
    name: 'Lucas',
    partnerName: null,
    referrerKind: 'seller',
    creditName: null,
  },
  referrer: null,
  referralDiscountPercent: 10,
};
const acceptance: InvitationAcceptance = {
  confirmOtherAccount: false,
  partnerIndex: 1,
  myTitle: 'bride',
  name: null,
};

function setup({
  invitation = coupleLink,
  user = { id: 'u-f', name: 'Fernanda', email: 'f@x.com', platformRole: 'none' as const },
  ownedWeddingId = null,
  referrerKind = null,
}: {
  invitation?: InvitationSnapshot;
  user?: { id: string; name: string | null; email: string; platformRole: 'none' };
  ownedWeddingId?: string | null;
  referrerKind?: 'planner' | 'seller' | null;
} = {}) {
  const store = {
    findByToken: jest.fn().mockResolvedValue(invitation),
    activeRole: jest.fn().mockResolvedValue(null),
    lockWedding: jest.fn().mockResolvedValue(undefined),
    accept: jest.fn().mockResolvedValue({ weddingId: 'w1', attributed: false }),
    handOverToCouple: jest.fn().mockResolvedValue('draft'),
    decline: jest.fn(),
  } satisfies InvitationAcceptanceStore;
  const owners = {
    lockOwner: jest.fn().mockResolvedValue(undefined),
    findActiveOwnedWeddingId: jest.fn().mockResolvedValue(ownedWeddingId),
    create: jest.fn(),
  } satisfies WeddingSignupStore;
  const users = { findProfileById: jest.fn().mockResolvedValue(user) } satisfies UserRepository;
  const names = { setName: jest.fn(), nameByEmail: jest.fn() } satisfies UserAccountNames;
  const profiles = {
    referrerKind: jest.fn().mockResolvedValue(referrerKind),
    createMinimal: jest.fn().mockResolvedValue(undefined),
  } satisfies PlannerProfiles;
  const productEvents: ProductEventRecorder = { record: jest.fn().mockResolvedValue(undefined) };
  const scheduled: (() => Promise<void>)[] = [];
  const sessions = {
    setActiveProfile: jest.fn().mockResolvedValue(undefined),
  } as unknown as SessionRepository;
  const useCase = new AcceptAccessInvitation(
    store,
    owners,
    { generate: jest.fn(), hash: ({ token }) => `h-${token}` },
    users,
    names,
    profiles,
    productEvents,
    { schedule: (work) => void scheduled.push(work) },
    sessions,
  );
  return { useCase, store, owners, names, profiles, productEvents, scheduled, sessions };
}

describe('AcceptAccessInvitation (POST /v1/access-invitations/{token}/accept)', () => {
  it('RN09 - primeiro aceite do casal: grava pelo banco, passa ao casal, tira o vendedor e agenda casal_aceitou', async () => {
    const { useCase, store, owners, productEvents, scheduled, sessions } = setup();

    const result = await useCase.execute({
      token: 't',
      userId: 'u-f',
      sessionId: 's1',
      acceptance,
      now,
    });

    expect(owners.lockOwner).toHaveBeenCalledWith({ userId: 'u-f' });
    expect(store.lockWedding).toHaveBeenCalledWith({ weddingId: 'w1' });
    expect(store.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: 'h-t',
        partnerSlot: 1,
        partnerTitle: 'bride',
        acceptedForEmail: null,
      }),
    );
    expect(store.handOverToCouple).toHaveBeenCalledWith({
      weddingId: 'w1',
      sellerUserId: 'u-lucas',
      now,
    });
    // Decisão 178: quem vira dono passa ao perfil de casal na sessão.
    expect(sessions.setActiveProfile).toHaveBeenCalledWith({
      sessionId: 's1',
      userId: 'u-f',
      profile: 'couple',
    });
    expect(result).toEqual({
      weddingId: 'w1',
      role: 'owner',
      weddingStatus: 'draft',
      attributedToMe: false,
    });
    expect(productEvents.record).not.toHaveBeenCalled();
    await scheduled[0]?.();
    expect(productEvents.record).toHaveBeenCalledWith({
      event: { name: 'casal_aceitou', weddingId: 'w1' },
      occurredAt: now,
    });
  });

  it('RN12 - convite vencido: 410 expired, sem gravar', async () => {
    const { useCase, store } = setup({ invitation: { ...coupleLink, expiresAt: now } });

    await expect(
      useCase.execute({ token: 't', userId: 'u-f', sessionId: 's1', acceptance, now }),
    ).rejects.toMatchObject(new InvitationInvalidError({ reason: 'expired' }));
    expect(store.accept).not.toHaveBeenCalled();
  });

  it('RN07 - convite por e-mail com a sessão de outro e-mail, sem confirmar: EMAIL_MISMATCH', async () => {
    const { useCase } = setup({ invitation: { ...coupleLink, email: 'outra@x.com' } });

    await expect(
      useCase.execute({ token: 't', userId: 'u-f', sessionId: 's1', acceptance, now }),
    ).rejects.toThrow(EmailMismatchError);
  });

  it('RN08 - quem já é dona de outro casamento: ALREADY_OWNER com ele', async () => {
    const { useCase } = setup({ ownedWeddingId: 'w-dela' });

    await expect(
      useCase.execute({ token: 't', userId: 'u-f', sessionId: 's1', acceptance, now }),
    ).rejects.toMatchObject(new AlreadyOwnerError({ weddingId: 'w-dela' }));
  });

  it('RN10 - cerimonialista sem perfil e sem nome: pede o nome (decisão 168)', async () => {
    const plannerInvite: InvitationSnapshot = {
      ...coupleLink,
      kind: 'planner',
      role: 'collaborator',
      email: 'j@x.com',
      wedding: { ...coupleLink.wedding, activeCollaborators: 0, activeOwners: 1 },
    };
    const { useCase, profiles } = setup({
      invitation: plannerInvite,
      user: { id: 'u-j', name: null, email: 'j@x.com', platformRole: 'none' },
    });

    await expect(
      useCase.execute({
        token: 't',
        userId: 'u-j',
        sessionId: 's1',
        acceptance: { ...acceptance, name: null },
        now,
      }),
    ).rejects.toThrow(AcceptanceDetailsMissingError);
    expect(profiles.createMinimal).not.toHaveBeenCalled();
  });

  it('RN10 - com o nome, grava o nome da conta e cria o perfil mínimo antes do aceite', async () => {
    const plannerInvite: InvitationSnapshot = {
      ...coupleLink,
      kind: 'planner',
      role: 'collaborator',
      email: 'j@x.com',
      wedding: { ...coupleLink.wedding, activeCollaborators: 0, activeOwners: 1 },
    };
    const { useCase, profiles, names, store } = setup({
      invitation: plannerInvite,
      user: { id: 'u-j', name: null, email: 'j@x.com', platformRole: 'none' },
    });

    await useCase.execute({
      token: 't',
      userId: 'u-j',
      sessionId: 's1',
      acceptance: { ...acceptance, name: ' Juliana  Prado ' },
      now,
    });

    expect(names.setName).toHaveBeenCalledWith({ userId: 'u-j', name: 'Juliana Prado' });
    expect(profiles.createMinimal).toHaveBeenCalledWith({
      userId: 'u-j',
      name: 'Juliana Prado',
      now,
    });
    expect(store.accept).toHaveBeenCalledWith(expect.objectContaining({ partnerSlot: null }));
    expect(store.handOverToCouple).not.toHaveBeenCalled();
  });

  it('decisão 175 - quem tem perfil de vendedor não aceita convite de cerimonialista', async () => {
    const { useCase, store, profiles } = setup({
      invitation: {
        ...coupleLink,
        kind: 'planner',
        role: 'collaborator',
        email: 'f@x.com',
        wedding: { ...coupleLink.wedding, activeCollaborators: 0, activeOwners: 1 },
      },
      referrerKind: 'seller',
    });

    await expect(
      useCase.execute({ token: 't', userId: 'u-f', sessionId: 's1', acceptance, now }),
    ).rejects.toThrow(SellerCannotBePlannerError);
    expect(profiles.createMinimal).not.toHaveBeenCalled();
    expect(store.accept).not.toHaveBeenCalled();
  });

  it('decisão 224 (2) - o indicador do casamento não aceita o link do casal: SELF_REFERRAL antes do ALREADY_MEMBER', async () => {
    const invitation: InvitationSnapshot = {
      ...coupleLink,
      referrer: {
        referrerId: 'r-lucas',
        userId: 'u-lucas',
        referralCode: 'lucas',
        kind: 'seller',
        status: 'active',
        accountStatus: 'active',
        displayName: 'Lucas',
        referralDiscountEnabled: true,
      },
    };
    const { useCase, store } = setup({
      invitation,
      user: { id: 'u-lucas', name: 'Lucas', email: 'l@x.com', platformRole: 'none' },
    });
    store.activeRole.mockResolvedValue('collaborator');

    await expect(
      useCase.execute({ token: 't', userId: 'u-lucas', sessionId: 's1', acceptance, now }),
    ).rejects.toThrow(SelfReferralError);
    expect(store.accept).not.toHaveBeenCalled();
  });

  it('decisão 224 (2) - a barreira da função do banco (KA005) também vira SELF_REFERRAL', async () => {
    const { useCase, store } = setup();
    store.accept.mockResolvedValue('self_referral');

    await expect(
      useCase.execute({ token: 't', userId: 'u-f', sessionId: 's1', acceptance, now }),
    ).rejects.toThrow(SelfReferralError);
  });
});
