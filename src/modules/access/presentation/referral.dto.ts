import { ApiProperty } from '@nestjs/swagger';
import type { Referral } from '../domain/referral';

/** GET /v1/referrals/{code}. */
export class ReferralResponse {
  @ApiProperty({ example: 'juliana-prado' }) code: string;
  @ApiProperty({ example: 'Juliana Prado' }) referrerName: string;
  @ApiProperty({ enum: ['planner', 'seller'] }) kind: Referral['kind'];
  /** Nulo quando o indicador está com o desconto desligado (RN09). */
  @ApiProperty({ type: Number, nullable: true, example: 10 }) discountPercent: number | null;

  static from({ referral }: { referral: Referral }): ReferralResponse {
    return { ...referral };
  }
}
