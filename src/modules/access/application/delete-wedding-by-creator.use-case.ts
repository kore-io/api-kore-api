import { Inject, Injectable, Logger } from '@nestjs/common';
import { WeddingActionForbiddenError, WeddingHasOwnerError } from '../domain/access.errors';
import {
  CREATOR_WEDDING_DELETER,
  type CreatorWeddingDeleter,
} from './ports/creator-wedding-deletion.port';
import { WeddingScope } from './wedding-scope.service';

const logger = new Logger('DeleteWeddingByCreator');

/**
 * Excluir este casamento (DELETE /v1/weddings/{weddingId}; Meus casamentos
 * RN11): a cerimonialista que criou o casamento, em rascunho ou aguardando o
 * casal e sem dono ativo. Primeiro a autorização sob a RLS (vínculo ativo,
 * senão 404); depois a transação do backoffice, que reconfere tudo sob o
 * lock; por fim os arquivos das imagens, depois do commit.
 */
@Injectable()
export class DeleteWeddingByCreator {
  constructor(
    private readonly scope: WeddingScope,
    @Inject(CREATOR_WEDDING_DELETER) private readonly deleter: CreatorWeddingDeleter,
  ) {}

  async execute({
    userId,
    weddingId,
    now,
  }: {
    userId: string;
    weddingId: string;
    now: Date;
  }): Promise<void> {
    await this.scope.run({ userId, weddingId, work: () => Promise.resolve() });
    const deletion = await this.deleter.deleteByCreator({ weddingId, userId, now });
    if (deletion.result === 'has_owner') throw new WeddingHasOwnerError();
    if (deletion.result === 'not_allowed') throw new WeddingActionForbiddenError();
    try {
      await this.deleter.deleteImageObjects({ imageKeyTokens: deletion.imageKeyTokens });
    } catch (error) {
      // O banco já está sem as linhas; arquivo que sobrar não é lido por ninguém.
      logger.error({ msg: 'site image objects left after deletion', weddingId, error });
    }
  }
}
