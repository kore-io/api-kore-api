import { RecomputeWeddingStats } from './recompute-wedding-stats.use-case';

describe('Rotina noturna de recálculo (Grupos RN16)', () => {
  it('RN16 - corrige as divergências e registra a execução no log, com a duração e sem dado pessoal', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const recompute = jest.fn().mockResolvedValue({ corrected: 2, skipped: 1 });
    const useCase = new RecomputeWeddingStats({ recompute }, { record });
    const now = new Date('2026-11-11T06:30:00Z');
    const clock = jest.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_250);

    await expect(useCase.execute({ now, clock })).resolves.toEqual({ corrected: 2, skipped: 1 });
    expect(recompute).toHaveBeenCalledWith({ weddingId: undefined });
    expect(record).toHaveBeenCalledWith({
      entry: {
        action: 'wedding_stats.recomputed',
        actorKind: 'system',
        data: { corrected: 2, skipped: 1, durationMs: 250, now: now.toISOString() },
      },
    });
  });
});
