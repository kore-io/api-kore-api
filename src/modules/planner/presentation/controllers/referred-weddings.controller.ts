import { Controller, Get } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, commonErrors } from '@/shared/http/api-error-responses.decorator';
import type { AuthenticatedSession } from '@/modules/access/domain/sessions/authenticated-session';
import { ProfileNotOwnedErrorBody } from '@/modules/access/presentation/dto/access-error.dto';
import { toHttpError } from '@/modules/access/presentation/errors/access-http-errors';
import { CurrentSession } from '@/modules/access/presentation/http/decorators/current-session.decorator';
import { ListReferredWeddings } from '@/modules/planner/application/referred-weddings.use-case';
import { MY_WEDDING_STATUSES, type MyWeddingStatus } from '@/modules/planner/domain/my-weddings';

class ReferredWeddingCommissionStatusResponse {
  @ApiProperty({ enum: ['available', 'pending', 'paid'] }) status: 'available' | 'pending' | 'paid';
  @ApiProperty({ example: 6742 }) amountCents: number;
}

/** A soma e os estados (Contrato de API); Estornada, Bloqueada e Retida não entram. */
class ReferredWeddingCommissionResponse {
  @ApiProperty({ example: 8482 }) totalCents: number;
  @ApiProperty({ type: [ReferredWeddingCommissionStatusResponse] })
  byStatus: ReferredWeddingCommissionStatusResponse[];
}

export class ReferredWeddingResponse {
  /** Nulo quando `clickable` é false (RN05). */
  @ApiProperty({ type: String, nullable: true }) weddingId: string | null;
  /** Os primeiros nomes; o app junta. */
  @ApiProperty({ type: [String], example: ['Ana', 'Marcos'] }) partnerNames: [string, string];
  @ApiProperty({ enum: MY_WEDDING_STATUSES }) status: MyWeddingStatus;
  /** Quando o casal entrou pelo link (a lista vem do mais recente; Contrato de API, decisão 288(2)). */
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  /**
   * A coluna Comissão (Comissões do indicador RN08): "R$ 67,42 disponível ·
   * R$ 17,40 aguardando"; nula sem pagamento ("—").
   */
  @ApiProperty({ type: ReferredWeddingCommissionResponse, nullable: true })
  commission: ReferredWeddingCommissionResponse | null;
  /** Ela colabora no casamento: a linha abre o detalhe em Meus casamentos (RN05). */
  @ApiProperty() clickable: boolean;
}

@ApiTags('planner')
@Controller('me/referrer/weddings')
export class ReferredWeddingsController {
  constructor(private readonly listReferred: ListReferredWeddings) {}

  /** Casais que vieram pelo seu link (Link de indicação RN03 a RN05). */
  @Get()
  @ApiErrorResponses(...commonErrors({ session: true }), ProfileNotOwnedErrorBody)
  async list(@CurrentSession() session: AuthenticatedSession): Promise<ReferredWeddingResponse[]> {
    try {
      const weddings = await this.listReferred.execute({ userId: session.userId });
      return weddings.map((wedding) => ({
        ...wedding,
        createdAt: wedding.createdAt.toISOString(),
      }));
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
