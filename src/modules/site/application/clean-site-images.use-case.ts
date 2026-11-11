import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import {
  SITE_IMAGE_CLEANUP,
  type SiteImageCleanup,
  type SiteImageCleanupCounts,
} from './ports/site-image-cleanup.port';

export const SITE_IMAGES_CLEANED_ACTION = 'site_images.cleaned';

const logger = new Logger('CleanSiteImages');

/**
 * Rotina diária da limpeza das imagens do site (S4 RN08; decisão 207, item 2):
 * envio abandonado (`uploading` ou `processing` há mais de 1 hora), `failed` e
 * `ready` fora de uso há mais de 24 horas, com os arquivos. Um casamento por
 * transação; a falha de um não para os outros. Um registro por execução, com
 * as contagens e o ator system, como o expurgo da lixeira.
 */
@Injectable()
export class CleanSiteImages {
  constructor(
    @Inject(SITE_IMAGE_CLEANUP) private readonly cleanup: SiteImageCleanup,
    @Inject(APPLICATION_LOG_WRITER) private readonly applicationLog: ApplicationLogWriter,
  ) {}

  async execute({
    now,
  }: {
    now: Date;
  }): Promise<SiteImageCleanupCounts & { weddingsFailed: number }> {
    const total = { stale: 0, failed: 0, unused: 0, weddingsFailed: 0 };
    for (const weddingId of await this.cleanup.weddingsWithCandidates({ now })) {
      try {
        const counts = await this.cleanup.cleanWedding({ weddingId, now });
        total.stale += counts.stale;
        total.failed += counts.failed;
        total.unused += counts.unused;
      } catch (error) {
        // A transação do casamento é desfeita; a próxima rodada tenta de novo.
        total.weddingsFailed += 1;
        logger.error(`Limpeza das imagens de um casamento falhou (${(error as Error).name}).`);
      }
    }
    await this.applicationLog.record({
      entry: {
        action: SITE_IMAGES_CLEANED_ACTION,
        actorKind: 'system',
        data: { ...total, now: now.toISOString() },
      },
    });
    return total;
  }
}
