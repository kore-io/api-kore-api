import type { PlannerProfiles } from '../../access/application/ports/planner-profiles.port';
import { ProfileNotOwnedError } from '../../access/domain/access.errors';
import type { ReferredWeddingsReader } from './ports/referred-weddings-reader.port';
import { ListReferredWeddings } from './referred-weddings.use-case';

const row = (clickable: boolean) => ({
  weddingId: clickable ? 'w-colabora' : 'w-so-link',
  status: 'draft' as const,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  partnerNames: ['Ana', 'Marcos'] as [string, string],
  clickable,
});

function useCase({ hasProfile = true }: { hasProfile?: boolean } = {}) {
  return new ListReferredWeddings(
    { findOwn: jest.fn().mockResolvedValue(hasProfile ? {} : null) } as unknown as PlannerProfiles,
    { list: jest.fn().mockResolvedValue([row(true), row(false)]) } satisfies ReferredWeddingsReader,
  );
}

describe('ListReferredWeddings (GET /v1/me/referrer/weddings)', () => {
  it('RN05 - o id só sai na linha clicável', async () => {
    const weddings = await useCase().execute({ userId: 'u-j' });

    expect(weddings.map(({ weddingId, clickable }) => ({ weddingId, clickable }))).toEqual([
      { weddingId: 'w-colabora', clickable: true },
      { weddingId: null, clickable: false },
    ]);
  });

  it('sem o perfil de cerimonialista: PROFILE_NOT_OWNED', async () => {
    await expect(useCase({ hasProfile: false }).execute({ userId: 'u-j' })).rejects.toThrow(
      ProfileNotOwnedError,
    );
  });
});
