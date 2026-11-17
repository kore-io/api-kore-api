import type { PlannerProfiles } from '@/modules/access/application/ports/planner-profiles.port';
import { ProfileNotOwnedError } from '@/modules/access/domain/access.errors';
import type { ReferredWeddingsReader } from './ports/referred-weddings-reader.port';
import type { CommissionRow } from '@/modules/planner/domain/commissions';
import { ListReferredWeddings } from './referred-weddings.use-case';

const row = (clickable: boolean) => ({
  weddingId: clickable ? 'w-colabora' : 'w-so-link',
  status: 'draft' as const,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  partnerNames: ['Ana', 'Marcos'] as [string, string],
  clickable,
});

const commission = (overrides: Partial<CommissionRow>): CommissionRow => ({
  id: 'c',
  weddingId: 'w-colabora',
  weddingPurged: false,
  partnerNames: ['Ana', 'Marcos'],
  clickable: true,
  paymentKind: 'publication',
  baseAmountCents: 33_710,
  amountCents: 6_742,
  ratePercent: 20,
  status: 'available',
  availableAt: new Date('2026-09-09T12:00:00Z'),
  paidAt: null,
  createdAt: new Date('2026-08-10T12:00:00Z'),
  payoutId: null,
  blockReason: null,
  ...overrides,
});

function useCase({
  hasProfile = true,
  commissions = [],
}: { hasProfile?: boolean; commissions?: CommissionRow[] } = {}) {
  return new ListReferredWeddings(
    { findOwn: jest.fn().mockResolvedValue(hasProfile ? {} : null) } as unknown as PlannerProfiles,
    { list: jest.fn().mockResolvedValue([row(true), row(false)]) } satisfies ReferredWeddingsReader,
    {
      list: jest.fn().mockResolvedValue(commissions),
      adjustments: jest.fn().mockResolvedValue([]),
    },
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

  it('Comissões RN08 - a coluna Comissão: a soma e os estados, com a paga e a que está em repasse; sem pagamento, nula; Estornada, Bloqueada e Retida fora', async () => {
    const weddings = await useCase({
      commissions: [
        commission({ id: 'a', status: 'available', amountCents: 6_742 }),
        commission({ id: 'b', status: 'pending', amountCents: 1_740 }),
        commission({ id: 'c', status: 'reversed', amountCents: 9_999 }),
        commission({ id: 'd', status: 'paid', amountCents: 2_000 }),
        // Disponível dentro de um repasse aberto: continua disponível.
        commission({ id: 'e', status: 'available', amountCents: 500, payoutId: 'p1' }),
        commission({ id: 'f', status: 'blocked', amountCents: 7_000 }),
        commission({ id: 'g', status: 'held', amountCents: 8_000 }),
      ],
    }).execute({ userId: 'u-j' });
    expect(weddings.map(({ commission: value }) => value)).toEqual([
      {
        totalCents: 6_742 + 500 + 1_740 + 2_000,
        byStatus: [
          { status: 'available', amountCents: 7_242 },
          { status: 'pending', amountCents: 1_740 },
          { status: 'paid', amountCents: 2_000 },
        ],
      },
      null,
    ]);
  });

  it('sem o perfil de cerimonialista: PROFILE_NOT_OWNED', async () => {
    await expect(useCase({ hasProfile: false }).execute({ userId: 'u-j' })).rejects.toThrow(
      ProfileNotOwnedError,
    );
  });
});
