import { Injectable } from '@nestjs/common';
import type { EmailTag } from './email-outbox.port';

/** Quem trata a desistência de um e-mail etiquetado com o seu tipo. */
export interface EmailGiveUpHandler {
  kind: string;
  onGaveUp({ tag }: { tag: EmailTag }): Promise<void>;
}

/**
 * Registro, no worker, de quem quer saber quando a fila desiste de um e-mail
 * etiquetado depois de todas as tentativas (decisão 180(8)). Os módulos se
 * registram na subida; o processador da fila avisa.
 */
@Injectable()
export class EmailDeliveryFailures {
  private readonly handlers = new Map<string, EmailGiveUpHandler>();

  register({ handler }: { handler: EmailGiveUpHandler }): void {
    this.handlers.set(handler.kind, handler);
  }

  async gaveUp({ tag }: { tag: EmailTag }): Promise<void> {
    await this.handlers.get(tag.kind)?.onGaveUp({ tag });
  }
}
