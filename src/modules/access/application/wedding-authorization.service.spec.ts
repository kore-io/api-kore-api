import { WeddingActionForbiddenError, WeddingNotFoundError } from '../domain/access.errors';
import type { MembershipRole } from '../domain/wedding-authorization';
import type { MembershipReader } from './ports/membership-reader.port';
import { WeddingAuthorization } from './wedding-authorization.service';

function authorizationFor({ role }: { role: MembershipRole | null }) {
  const reader: MembershipReader = { activeRole: jest.fn().mockResolvedValue(role) };
  return new WeddingAuthorization(reader);
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
});
