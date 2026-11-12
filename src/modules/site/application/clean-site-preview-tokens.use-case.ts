import { Inject, Injectable } from '@nestjs/common';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import { PREVIEW_TOKEN_RETENTION_MS } from '../domain/site-preview';
import {
  SITE_PREVIEW_TOKEN_CLEANUP,
  type SitePreviewTokenCleanup,
} from './ports/site-preview-token-cleanup.port';

export const SITE_PREVIEW_TOKENS_CLEANED_ACTION = 'site_preview_tokens.cleaned';

/**
 * A rotina diária apaga os tokens da prévia com mais de 1 dia (Pré-visualização,
 * modelo): usados ou vencidos, não servem mais para nada. Um registro por
 * execução, como as outras rotinas.
 */
@Injectable()
export class CleanSitePreviewTokens {
  constructor(
    @Inject(SITE_PREVIEW_TOKEN_CLEANUP) private readonly cleanup: SitePreviewTokenCleanup,
    @Inject(APPLICATION_LOG_WRITER) private readonly applicationLog: ApplicationLogWriter,
  ) {}

  async execute({ now }: { now: Date }): Promise<{ deleted: number }> {
    const deleted = await this.cleanup.deleteCreatedBefore({
      before: new Date(now.getTime() - PREVIEW_TOKEN_RETENTION_MS),
    });
    await this.applicationLog.record({
      entry: {
        action: SITE_PREVIEW_TOKENS_CLEANED_ACTION,
        actorKind: 'system',
        data: { deleted, now: now.toISOString() },
      },
    });
    return { deleted };
  }
}
