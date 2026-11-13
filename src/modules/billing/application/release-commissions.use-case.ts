import { Inject, Injectable } from '@nestjs/common';
import { COMMISSION_RELEASE, type CommissionRelease } from './ports/commission-release.port';

/**
 * A rotina diária da liberação das comissões (Comissões do indicador RN02 e
 * RN09), com o relógio injetado: o que foi pago às 15h20 de 10/08 libera na
 * rodada das 4h de 09/09 (a data, não a hora; B6-5).
 */
@Injectable()
export class ReleaseCommissions {
  constructor(@Inject(COMMISSION_RELEASE) private readonly store: CommissionRelease) {}

  async execute({
    now,
    referrerId,
  }: {
    now: Date;
    referrerId?: string;
  }): Promise<{ released: number }> {
    return { released: (await this.store.release({ now, referrerId })).length };
  }
}
