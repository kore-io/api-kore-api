import { PurgeTrash } from './purge-trash.use-case';

describe('Expurgo da lixeira (Lixeira RN10 e RN11)', () => {
  it('RN11 - grava um registro por execução, com as contagens e o ator system', async () => {
    const record = jest.fn().mockResolvedValue(undefined);
    const counts = { parties: 1, guests: 4, tags: 2 };
    const useCase = new PurgeTrash({ purgeDue: jest.fn().mockResolvedValue(counts) }, { record });
    const now = new Date('2026-12-07T06:00:00Z');

    await expect(useCase.execute({ now })).resolves.toEqual(counts);
    expect(record).toHaveBeenCalledWith({
      entry: {
        action: 'guests.purged',
        actorKind: 'system',
        data: { ...counts, now: now.toISOString() },
      },
    });
  });
});
