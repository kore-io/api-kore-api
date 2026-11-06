import { removalRefusal } from './membership-removal';

const owner = { userId: 'u-ana', role: 'owner' as const };
const planner = { userId: 'u-juliana', role: 'collaborator' as const };

describe('Remover ou sair de um vínculo (RN06 e RN07 de Papéis)', () => {
  it('RN06 - o dono remove o colaborador, e o colaborador sai', () => {
    expect(
      removalRefusal({
        requesterId: 'u-ana',
        requesterRole: 'owner',
        target: planner,
        activeOwners: 1,
      }),
    ).toBeNull();
    expect(
      removalRefusal({
        requesterId: 'u-juliana',
        requesterRole: 'collaborator',
        target: planner,
        activeOwners: 1,
      }),
    ).toBeNull();
  });

  it('RN03 - o colaborador não remove ninguém além de si', () => {
    expect(
      removalRefusal({
        requesterId: 'u-juliana',
        requesterRole: 'collaborator',
        target: owner,
        activeOwners: 1,
      }),
    ).toBe('action_not_allowed');
  });

  it('RN07 - um dono não remove o outro; o último dono não sai; com 2 donos, um sai', () => {
    const marcos = { userId: 'u-marcos', role: 'owner' as const };
    expect(
      removalRefusal({
        requesterId: 'u-ana',
        requesterRole: 'owner',
        target: marcos,
        activeOwners: 2,
      }),
    ).toBe('cannot_remove_owner');
    expect(
      removalRefusal({
        requesterId: 'u-ana',
        requesterRole: 'owner',
        target: owner,
        activeOwners: 1,
      }),
    ).toBe('last_owner');
    expect(
      removalRefusal({
        requesterId: 'u-ana',
        requesterRole: 'owner',
        target: owner,
        activeOwners: 2,
      }),
    ).toBeNull();
  });
});
