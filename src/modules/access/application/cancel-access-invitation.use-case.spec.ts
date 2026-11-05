import {
  InvitationNotFoundError,
  InvitationNotPendingError,
  WeddingActionForbiddenError,
} from '../domain/access.errors';
import { CancelAccessInvitation } from './cancel-access-invitation.use-case';
import type { AccessInvitationStore, StoredInvitation } from './ports/access-invitation-store.port';
import type { WeddingAuthorization } from './wedding-authorization.service';

const now = new Date('2026-11-10T00:00:00Z');
const pending: StoredInvitation = {
  id: 'i1',
  invitedByUserId: 'u-juliana',
  expiresAt: new Date('2026-12-01T00:00:00Z'),
  acceptedAt: null,
  declinedAt: null,
  revokedAt: null,
  supersededAt: null,
};

function setup({
  invitation,
  role,
}: {
  invitation: StoredInvitation | null;
  role: 'owner' | 'collaborator';
}) {
  const store = {
    lockWedding: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue(invitation),
    revoke: jest.fn().mockResolvedValue(undefined),
    touchActivity: jest.fn().mockResolvedValue(undefined),
  } as unknown as AccessInvitationStore;
  const authorization = {
    require: jest.fn().mockResolvedValue(role),
  } as unknown as WeddingAuthorization;
  return { useCase: new CancelAccessInvitation(authorization, store), store };
}

const input = { weddingId: 'w1', invitationId: 'i1', now };

describe('CancelAccessInvitation (DELETE /v1/weddings/{weddingId}/access-invitations/{id})', () => {
  it('RN05 - quem enviou cancela o pendente, e conta como atividade (RN13)', async () => {
    const { useCase, store } = setup({ invitation: pending, role: 'collaborator' });

    await useCase.execute({ ...input, userId: 'u-juliana' });

    expect(store.revoke).toHaveBeenCalledWith({ invitationId: 'i1', now });
    expect(store.touchActivity).toHaveBeenCalledWith({ weddingId: 'w1', now });
  });

  it('RN05 - um colaborador que não enviou não cancela (403)', async () => {
    const { useCase } = setup({ invitation: pending, role: 'collaborator' });

    await expect(useCase.execute({ ...input, userId: 'u-outra' })).rejects.toThrow(
      WeddingActionForbiddenError,
    );
  });

  it('RN05 - convite vencido ou já usado não está pendente (409 NOT_PENDING)', async () => {
    const { useCase } = setup({
      invitation: { ...pending, expiresAt: new Date('2026-11-01T00:00:00Z') },
      role: 'owner',
    });

    await expect(useCase.execute({ ...input, userId: 'u-ana' })).rejects.toThrow(
      InvitationNotPendingError,
    );
  });

  it('convite de outro casamento ou inexistente dá 404', async () => {
    const { useCase } = setup({ invitation: null, role: 'owner' });

    await expect(useCase.execute({ ...input, userId: 'u-ana' })).rejects.toThrow(
      InvitationNotFoundError,
    );
  });
});
