import { Inject, Injectable } from '@nestjs/common';

/** A ativação das trocas que venceram, pela conexão do backoffice (o worker). */
export interface PixKeyActivation {
  activateDue(input: { now: Date; referrerId?: string }): Promise<number>;
}

export const PIX_KEY_ACTIVATION = Symbol('PixKeyActivation');

/**
 * A troca confirmada vale 48 h depois (Repasse RN03; decisão 62): a rotina de
 * 15 minutos ativa as que venceram (a antiga fica substituída) e devolve a
 * Solicitado o repasse retido pela troca (RN06 (b)). As rotas também ativam,
 * na hora, as da própria pessoa.
 */
@Injectable()
export class ActivatePixKeys {
  constructor(@Inject(PIX_KEY_ACTIVATION) private readonly store: PixKeyActivation) {}

  async execute({ now, referrerId }: { now: Date; referrerId?: string }): Promise<{
    activated: number;
  }> {
    return { activated: await this.store.activateDue({ now, referrerId }) };
  }
}
