import type { AppConfigService } from '../../../shared/config/app-config.service';
import type { FieldCipher } from '../../../shared/crypto/application/field-cipher.port';
import type { PlannerProfiles } from '../../access/application/ports/planner-profiles.port';
import type { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { ProfileNotOwnedError, WeddingNotFoundError } from '../../access/domain/access.errors';
import { GetMyWedding } from './my-weddings.use-cases';
import type {
  CollaborationDetail,
  PlannerWeddingsReader,
} from './ports/planner-weddings-reader.port';

const now = new Date('2026-11-12T15:00:00Z');
const link = {
  id: 'link',
  email: null,
  invitedByUserId: 'u-j',
  createdAt: new Date('2026-11-10T00:00:00Z'),
  expiresAt: new Date('2026-12-10T00:00:00Z'),
  tokenEncrypted: 'cifrado',
};
const detail = (extra: Partial<CollaborationDetail> = {}): CollaborationDetail => ({
  weddingId: 'w1',
  partnerNames: ['Fernanda', 'João'],
  eventDate: null,
  city: 'Valinhos',
  state: 'SP',
  timezone: 'America/Sao_Paulo',
  status: 'awaiting_couple',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  createdByUserId: 'u-j',
  referralSource: 'created_by_planner',
  referrerUserId: 'u-j',
  rsvpDeadline: null,
  stats: { guestsTotal: 0, confirmed: 0, declined: 0, pending: 0, rsvpPercent: 0 },
  slug: 'fernanda-e-joao',
  hasOwner: false,
  pendingCoupleInvitations: [link],
  ...extra,
});

function setup({
  found = detail(),
  hasProfile = true,
}: { found?: CollaborationDetail | null; hasProfile?: boolean } = {}) {
  const decrypt = jest.fn().mockResolvedValue('o-token');
  const useCase = new GetMyWedding(
    { get: () => 'http://localhost:5173' } as unknown as AppConfigService,
    { canManageSiteIdentity: jest.fn().mockResolvedValue(true) } as unknown as WeddingAuthorization,
    { findOwn: jest.fn().mockResolvedValue(hasProfile ? {} : null) } as unknown as PlannerProfiles,
    {
      listCollaborations: jest.fn(),
      deliveryCounts: jest.fn(),
      collaboration: jest.fn().mockResolvedValue(found),
    } satisfies PlannerWeddingsReader,
    { encrypt: jest.fn(), decrypt } satisfies FieldCipher,
  );
  return { useCase, decrypt };
}

describe('GetMyWedding (GET /v1/me/weddings/{id})', () => {
  it('RN09 (N1(b)) - o link vigente vem decifrado só para quem o gerou, no contexto do casamento', async () => {
    const { useCase, decrypt } = setup();

    const view = await useCase.execute({ userId: 'u-j', weddingId: 'w1', now });

    expect(view.coupleInvitations).toEqual([
      {
        type: 'link',
        id: 'link',
        expiresAt: link.expiresAt,
        state: 'active',
        url: 'http://localhost:5173/convite/o-token',
      },
    ]);
    expect(decrypt).toHaveBeenCalledWith({
      ciphertext: 'cifrado',
      context: { table: 'access_invitations', column: 'token_encrypted', weddingId: 'w1' },
    });
  });

  it('RN09 (N1(b)) - o link gerado por outra pessoa (o vendedor que criou) não vem com url', async () => {
    const { useCase, decrypt } = setup({
      found: detail({ pendingCoupleInvitations: [{ ...link, invitedByUserId: 'u-lucas' }] }),
    });

    const view = await useCase.execute({ userId: 'u-j', weddingId: 'w1', now });

    expect(view.coupleInvitations[0]).toMatchObject({ type: 'link', url: null });
    expect(decrypt).not.toHaveBeenCalled();
  });

  it('revisão C2-8 - quando ela não criou o casamento, os convites do casal não vêm', async () => {
    const { useCase } = setup({ found: detail({ createdByUserId: 'u-ana' }) });

    expect(
      (await useCase.execute({ userId: 'u-j', weddingId: 'w1', now })).coupleInvitations,
    ).toEqual([]);
  });

  it('sem o perfil: PROFILE_NOT_OWNED; sem vínculo de colaboradora: WEDDING_NOT_FOUND', async () => {
    await expect(
      setup({ hasProfile: false }).useCase.execute({ userId: 'u-j', weddingId: 'w1', now }),
    ).rejects.toThrow(ProfileNotOwnedError);
    await expect(
      setup({ found: null }).useCase.execute({ userId: 'u-j', weddingId: 'w1', now }),
    ).rejects.toThrow(WeddingNotFoundError);
  });
});
