import { InvitationNotDeclinableError } from '../domain/access.errors';
import type { InvitationSnapshot } from '../domain/invitation-acceptance';
import { DeclineAccessInvitation } from './decline-access-invitation.use-case';
import type { DeclineNotice } from './ports/decline-notice-mailer.port';
import type { InvitationAcceptanceStore } from './ports/invitation-acceptance-store.port';

const now = new Date('2026-11-10T00:00:00Z');
const partnerInvite = {
  id: 'i1',
  weddingId: 'w1',
  kind: 'partner',
  email: 'marcos@x.com',
  role: 'owner',
  expiresAt: new Date('2026-12-01T00:00:00Z'),
  acceptedAt: null,
  declinedAt: null,
  revokedAt: null,
  supersededAt: null,
  wedding: {
    partners: [
      { slot: 1, displayName: 'Ana Beatriz', title: 'bride', userId: 'u-ana' },
      { slot: 2, displayName: 'Marcos Rocha', title: null, userId: null },
    ],
  },
  inviter: { email: 'ana@x.com', name: 'Ana', partnerName: 'Ana Beatriz' },
} as unknown as InvitationSnapshot;

function setup({
  invitation,
  accountName = null,
}: {
  invitation: InvitationSnapshot;
  accountName?: string | null;
}) {
  const notices: DeclineNotice[] = [];
  const store = {
    findByToken: jest.fn().mockResolvedValue(invitation),
    decline: jest.fn().mockResolvedValue(true),
  } as unknown as InvitationAcceptanceStore;
  const useCase = new DeclineAccessInvitation(
    store,
    { generate: jest.fn(), hash: ({ token }) => `h-${token}` },
    { setName: jest.fn(), nameByEmail: jest.fn().mockResolvedValue(accountName) },
    {
      send: ({ notice }) => {
        notices.push(notice);
        return Promise.resolve();
      },
    },
  );
  return { useCase, store, notices };
}

describe('DeclineAccessInvitation (POST /v1/access-invitations/{token}/decline)', () => {
  it('RN11 - recusa o do parceiro e avisa quem convidou com o nome do noivo convidado', async () => {
    const { useCase, notices } = setup({ invitation: partnerInvite });

    await useCase.execute({ token: 't', now });

    expect(notices).toEqual([
      {
        kind: 'partner',
        to: 'ana@x.com',
        inviterName: 'Ana',
        declinedBy: 'Marcos',
        partnerNames: ['Ana', 'Marcos'],
        inviterIsOwner: true,
      },
    ]);
  });

  it('RN11 - no do cerimonialista, o primeiro nome da conta; sem conta, o e-mail convidado', async () => {
    const planner = { ...partnerInvite, kind: 'planner', email: 'j@x.com' } as InvitationSnapshot;

    const withAccount = setup({ invitation: planner, accountName: 'Juliana Prado' });
    await withAccount.useCase.execute({ token: 't', now });
    const withoutAccount = setup({ invitation: planner });
    await withoutAccount.useCase.execute({ token: 't', now });

    expect(withAccount.notices[0]?.declinedBy).toBe('Juliana');
    expect(withoutAccount.notices[0]?.declinedBy).toBe('j@x.com');
  });

  it('decisão 136 (8) - o link sem e-mail não tem Recusar e nada muda', async () => {
    const { useCase, store } = setup({
      invitation: { ...partnerInvite, kind: 'couple', email: null },
    });

    await expect(useCase.execute({ token: 't', now })).rejects.toThrow(
      InvitationNotDeclinableError,
    );
    expect(store.decline).not.toHaveBeenCalled();
  });
});
