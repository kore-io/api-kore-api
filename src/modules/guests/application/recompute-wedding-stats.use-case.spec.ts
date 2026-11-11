import { RecomputeWeddingStats } from './recompute-wedding-stats.use-case';

describe('Rotina noturna de recálculo (Grupos RN16)', () => {
  it('RN16 - corrige as divergências e registra a execução no log, sem dado pessoal', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const useCase = new RecomputeWeddingStats(
      { recomputeAll: jest.fn().mockResolvedValue(2) },
      { record },
    );
    const now = new Date('2026-11-11T06:30:00Z');

    await expect(useCase.execute({ now })).resolves.toEqual({ corrected: 2 });
    expect(record).toHaveBeenCalledWith({
      entry: {
        action: 'wedding_stats.recomputed',
        actorKind: 'system',
        data: { corrected: 2, now: now.toISOString() },
      },
    });
  });
});
