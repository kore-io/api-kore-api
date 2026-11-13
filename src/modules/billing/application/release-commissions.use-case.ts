import { Inject, Injectable, Logger } from '@nestjs/common';
import { COMMISSION_NOTICES, type CommissionNotices } from './ports/commission-notices.port';
import { COMMISSION_RELEASE, type CommissionRelease } from './ports/commission-release.port';

const logger = new Logger('ReleaseCommissions');

/**
 * A rotina diária da liberação das comissões (Comissões do indicador RN02 e
 * RN09), com o relógio injetado: o que foi pago às 15h20 de 10/08 libera na
 * rodada das 4h de 09/09 (a data, não a hora; B6-5). Depois do commit, o push
 * e o e-mail "Na hora" (decisão 242); uma falha aqui não desfaz a liberação, e
 * o Resumo diário ainda avisa por e-mail.
 */
@Injectable()
export class ReleaseCommissions {
  constructor(
    @Inject(COMMISSION_RELEASE) private readonly store: CommissionRelease,
    @Inject(COMMISSION_NOTICES) private readonly notices: CommissionNotices,
  ) {}

  async execute({
    now,
    referrerId,
  }: {
    now: Date;
    referrerId?: string;
  }): Promise<{ released: number }> {
    const released = await this.store.release({ now, referrerId });
    if (released.length > 0) {
      try {
        await this.notices.released({
          items: released.map((row) => ({ userId: row.referrerUserId, weddingId: row.weddingId })),
        });
      } catch (error) {
        logger.warn(`Avisos da comissão não enfileirados: ${(error as Error).name}`);
      }
    }
    return { released: released.length };
  }
}
