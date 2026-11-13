import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type { PixKeyActivation } from '../../application/activate-pix-keys.use-case';

/** Pela conexão do backoffice: a função trava cada Referrer antes de trocar a chave. */
@Injectable()
export class PrismaPixKeyActivation implements PixKeyActivation {
  constructor(private readonly prisma: BackofficePrismaService) {}

  async activateDue({ now, referrerId }: { now: Date; referrerId?: string }): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ activated: number }[]>`
      SELECT activate_due_referrer_pix_keys(${now}::timestamptz,
                                            ${referrerId ?? null}::uuid) AS activated`;
    return row.activated;
  }
}
