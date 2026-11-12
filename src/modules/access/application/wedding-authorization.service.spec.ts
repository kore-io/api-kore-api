import { WeddingActionForbiddenError, WeddingNotFoundError } from '../domain/access.errors';
import type { MembershipRole } from '../domain/wedding-authorization';
import type { MembershipReader } from './ports/membership-reader.port';
import type { PlannerProfiles } from './ports/planner-profiles.port';
import { WeddingAuthorization } from './wedding-authorization.service';

function authorizationFor({
  role,
  referrerKind = null,
  hasActiveOwner = true,
}: {
  role: MembershipRole | null;
  referrerKind?: 'planner' | 'seller' | null;
  hasActiveOwner?: boolean;
}) {
  const reader: MembershipReader = {
    activeRole: jest.fn().mockResolvedValue(role),
    hasActiveOwner: jest.fn().mockResolvedValue(hasActiveOwner),
  };
  const profiles = {
    referrerKind: jest.fn().mockResolvedValue(referrerKind),
  } as unknown as PlannerProfiles;
  return new WeddingAuthorization(reader, profiles);
}

const target = { userId: 'u1', weddingId: 'w1' };

describe('WeddingAuthorization (autorização central; decisão 153)', () => {
  it('RN01 - dada uma pessoa sem vínculo, quando pede qualquer ação, então o casamento "não existe"', async () => {
    const authorization = authorizationFor({ role: null });

    expect(await authorization.can({ ...target, action: 'view' })).toBe(false);
    await expect(authorization.require({ ...target, action: 'view' })).rejects.toThrow(
      WeddingNotFoundError,
    );
  });

  it('RN03 - dado o colaborador, quando tenta remover colaborador, então é proibido (403), não "não encontrado"', async () => {
    const authorization = authorizationFor({ role: 'collaborator' });

    expect(await authorization.can({ ...target, action: 'remove_collaborator' })).toBe(false);
    await expect(
      authorization.require({ ...target, action: 'remove_collaborator' }),
    ).rejects.toThrow(WeddingActionForbiddenError);
  });

  it('RN02 - dado o dono, quando exige a ação, então devolve o papel', async () => {
    await expect(
      authorizationFor({ role: 'owner' }).require({ ...target, action: 'remove_collaborator' }),
    ).resolves.toBe('owner');
  });

  describe('manage_site_identity (Dados básicos RN04; decisão 207, item 13)', () => {
    it('RN04 - o dono muda a data, a UF e o endereço', async () => {
      expect(await authorizationFor({ role: 'owner' }).canManageSiteIdentity(target)).toBe(true);
    });

    it('RN04 - o vendedor muda enquanto o casamento não tem dono ativo, e não depois do aceite', async () => {
      const before = authorizationFor({
        role: 'collaborator',
        referrerKind: 'seller',
        hasActiveOwner: false,
      });
      const after = authorizationFor({
        role: 'collaborator',
        referrerKind: 'seller',
        hasActiveOwner: true,
      });

      expect(await before.canManageSiteIdentity(target)).toBe(true);
      expect(await after.canManageSiteIdentity(target)).toBe(false);
    });

    it('RN04 - a cerimonialista nunca muda, nem num casamento sem dono', async () => {
      const planner = authorizationFor({
        role: 'collaborator',
        referrerKind: 'planner',
        hasActiveOwner: false,
      });

      expect(await planner.canManageSiteIdentity(target)).toBe(false);
    });

    it('RN04 - sem vínculo, não muda', async () => {
      expect(await authorizationFor({ role: null }).canManageSiteIdentity(target)).toBe(false);
    });
  });
});
