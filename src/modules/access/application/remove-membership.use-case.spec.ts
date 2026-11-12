import type { ApplicationLogWriter } from '../../logs/application/ports/application-log-writer.port';
import {
  LastOwnerError,
  MembershipNotFoundError,
  WeddingHasNoOwnerError,
} from '../domain/access.errors';
import type { WeddingMember, WeddingMembersStore } from './ports/wedding-members-store.port';
import { RemoveMembership } from './remove-membership.use-case';
import type { WeddingAuthorization } from './wedding-authorization.service';

const now = new Date('2026-11-10T00:00:00Z');
const ana: WeddingMember = { id: 'm-ana', userId: 'u-ana', name: 'Ana', role: 'owner' };
const marcos: WeddingMember = { id: 'm-marcos', userId: 'u-marcos', name: 'Marcos', role: 'owner' };
const juliana: WeddingMember = {
  id: 'm-j',
  userId: 'u-j',
  name: 'Juliana',
  role: 'collaborator',
  kind: 'planner',
};

function setup({ members, role }: { members: WeddingMember[]; role: 'owner' | 'collaborator' }) {
  const store = {
    listActive: jest.fn().mockResolvedValue(members),
    listPendingInvitations: jest.fn(),
    lockWedding: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    releasePartnerLogin: jest.fn().mockResolvedValue(undefined),
  } satisfies WeddingMembersStore;
  const log: ApplicationLogWriter = { record: jest.fn().mockResolvedValue(undefined) };
  const authorization = {
    require: jest.fn().mockResolvedValue(role),
  } as unknown as WeddingAuthorization;
  const useCase = new RemoveMembership(authorization, store, log);
  return { useCase, store, log };
}

describe('RemoveMembership (DELETE /v1/weddings/{weddingId}/memberships/{id})', () => {
  it('RN06 e RN10 - o dono remove a cerimonialista, com o log na mesma transação (decisão 179)', async () => {
    const { useCase, store, log } = setup({ members: [ana, juliana], role: 'owner' });

    await useCase.execute({
      userId: 'u-ana',
      weddingId: 'w1',
      membershipId: 'm-j',
      ip: '10.0.0.1',
      now,
    });

    expect(store.remove).toHaveBeenCalledWith({
      membershipId: 'm-j',
      removedByUserId: 'u-ana',
      now,
    });
    expect(store.releasePartnerLogin).not.toHaveBeenCalled();
    expect(log.record).toHaveBeenCalledWith({
      entry: expect.objectContaining({
        action: 'membership.removed',
        actorUserId: 'u-ana',
        weddingId: 'w1',
        entityId: 'm-j',
        data: { membershipId: 'm-j', role: 'collaborator' },
        ip: '10.0.0.1',
      }),
    });
  });

  it('RN07 e decisão 177 (10) - o dono que sai (com outro dono) solta o login do noivo e registra membership.left', async () => {
    const { useCase, store, log } = setup({ members: [ana, marcos], role: 'owner' });

    await useCase.execute({
      userId: 'u-marcos',
      weddingId: 'w1',
      membershipId: 'm-marcos',
      ip: null,
      now,
    });

    expect(store.releasePartnerLogin).toHaveBeenCalledWith({ weddingId: 'w1' });
    expect(log.record).toHaveBeenCalledWith({
      entry: expect.objectContaining({ action: 'membership.left' }),
    });
  });

  it('RN07 - o último dono não sai', async () => {
    const { useCase, store } = setup({ members: [ana, juliana], role: 'owner' });

    await expect(
      useCase.execute({ userId: 'u-ana', weddingId: 'w1', membershipId: 'm-ana', ip: null, now }),
    ).rejects.toThrow(LastOwnerError);
    expect(store.remove).not.toHaveBeenCalled();
  });

  it('decisão 224 (1) - a cerimonialista não sai de casamento sem dono: WEDDING_HAS_NO_OWNER, sem log', async () => {
    const { useCase, store, log } = setup({ members: [juliana], role: 'collaborator' });

    await expect(
      useCase.execute({ userId: 'u-j', weddingId: 'w1', membershipId: 'm-j', ip: null, now }),
    ).rejects.toThrow(WeddingHasNoOwnerError);
    expect(store.lockWedding).toHaveBeenCalledWith({ weddingId: 'w1' });
    expect(store.remove).not.toHaveBeenCalled();
    expect(log.record).not.toHaveBeenCalled();
  });

  it('vínculo que não está entre os ativos do casamento: MEMBERSHIP_NOT_FOUND', async () => {
    const { useCase } = setup({ members: [ana], role: 'owner' });

    await expect(
      useCase.execute({ userId: 'u-ana', weddingId: 'w1', membershipId: 'outro', ip: null, now }),
    ).rejects.toThrow(MembershipNotFoundError);
  });
});
