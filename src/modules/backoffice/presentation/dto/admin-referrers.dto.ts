import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength, NotEquals } from 'class-validator';
import { SetTaxIdBody } from '@/modules/referral/presentation/dto/payout-data.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Corrigir CPF ou CNPJ (RN08; decisão 74): o documento novo e o motivo. */
export class CorrectTaxIdBody extends SetTaxIdBody {
  @ApiProperty({ minLength: 10, maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

/** Ajustar a comissão (RN08): Somar (+) ou Descontar (−), em centavos, e o motivo. */
export class AdjustmentBody {
  @ApiProperty({ example: -1000, description: 'Diferente de zero; negativo desconta.' })
  @IsInt()
  @NotEquals(0)
  @Min(-10_000_000)
  @Max(10_000_000)
  amountCents: number;

  @ApiProperty({ minLength: 10, maxLength: 500 })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class ReferrerBlockResponse {
  @ApiProperty({ enum: ['blocked'] }) status: 'blocked';
  /** Os repasses pedidos que ficaram retidos. */
  @ApiProperty({ type: [String], format: 'uuid' }) heldPayoutIds: string[];
}

export class ReferrerUnblockResponse {
  @ApiProperty({ enum: ['active'] }) status: 'active';
}

export class CommissionBlockResponse {
  @ApiProperty({ enum: ['blocked'] }) status: 'blocked';
  /** O repasse pedido retido por ela, se havia. */
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) heldPayoutId: string | null;
}

export class CommissionUnblockResponse {
  /** `held` com o pagamento em disputa ou em estorno: segue o desfecho (decisão 290(4)). */
  @ApiProperty({ enum: ['pending', 'available', 'held'] }) status: 'pending' | 'available' | 'held';
  /** O casamento da comissão segue bloqueado: "O casamento continua bloqueado." (decisão 284(3)). */
  weddingBlocked: boolean;
}

export class AdjustmentResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
}

export class CorrectTaxIdResponse {
  @ApiProperty({ enum: ['cpf', 'cnpj'] }) taxIdType: 'cpf' | 'cnpj';
  @ApiProperty({ example: '***.982.247-**' }) taxIdMasked: string;
}
