import { Inject, Injectable } from '@nestjs/common';
import {
  AWAITING_COUPLE_WEDDINGS,
  type AwaitingCoupleWeddings,
} from '@/modules/access/application/ports/awaiting-couple-weddings.port';

/**
 * Decisão 297 (Meus casamentos e alertas RN08): "aguardando o casal" é o
 * casamento com convite; quando o último convite de dono vence, ele volta a
 * rascunho ("Você ainda não convidou o casal."). Na rotina diária das 3h30,
 * com o relógio injetado; `weddingId` recorta a rodada (o teste).
 */
@Injectable()
export class RevertExpiredCoupleInvitations {
  constructor(
    @Inject(AWAITING_COUPLE_WEDDINGS) private readonly weddings: AwaitingCoupleWeddings,
  ) {}

  async execute({
    now,
    weddingId,
  }: {
    now: Date;
    weddingId?: string;
  }): Promise<{ reverted: number }> {
    let reverted = 0;
    for (const id of await this.weddings.listWithoutPendingInvitation({ now, weddingId }))
      if (await this.weddings.revert({ weddingId: id, now })) reverted++;
    return { reverted };
  }
}
