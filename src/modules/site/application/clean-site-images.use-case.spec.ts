import type { ApplicationLogWriter } from '../../logs/application/ports/application-log-writer.port';
import { CleanSiteImages } from './clean-site-images.use-case';
import type { SiteImageCleanup } from './ports/site-image-cleanup.port';

describe('CleanSiteImages (Imagens do site RN08)', () => {
  const now = new Date('2026-11-12T05:30:00Z');

  it('RN08 - soma os casamentos, segue depois de uma falha e grava um registro por execução', async () => {
    const cleanup: SiteImageCleanup = {
      weddingsWithCandidates: jest.fn().mockResolvedValue(['a', 'b', 'c']),
      cleanWedding: jest
        .fn()
        .mockResolvedValueOnce({ stale: 1, failed: 0, unused: 2 })
        .mockRejectedValueOnce(new Error('armazenamento fora'))
        .mockResolvedValueOnce({ stale: 0, failed: 3, unused: 1 }),
    };
    const record = jest.fn().mockResolvedValue(undefined);
    const log = { record } as unknown as ApplicationLogWriter;

    const counts = await new CleanSiteImages(cleanup, log).execute({ now });

    expect(counts).toEqual({ stale: 1, failed: 3, unused: 3, weddingsFailed: 1 });
    expect(cleanup.cleanWedding).toHaveBeenCalledTimes(3);
    expect(record).toHaveBeenCalledWith({
      entry: {
        action: 'site_images.cleaned',
        actorKind: 'system',
        data: { stale: 1, failed: 3, unused: 3, weddingsFailed: 1, now: now.toISOString() },
      },
    });
  });
});
