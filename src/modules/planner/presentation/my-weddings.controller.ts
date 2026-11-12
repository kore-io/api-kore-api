import { Controller, Get, Header, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { WeddingNotFoundError } from '../../access/domain/access.errors';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import {
  ProfileNotOwnedErrorBody,
  WeddingNotFoundErrorBody,
} from '../../access/presentation/access-error.dto';
import { toHttpError } from '../../access/presentation/access-http-errors';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import { GetMyWedding, ListMyWeddings } from '../application/my-weddings.use-cases';
import { MyWeddingDetailResponse, MyWeddingsResponse } from './my-weddings.dto';

/**
 * Meus casamentos da cerimonialista (Meus casamentos e alertas). O parâmetro
 * é `id`, não `weddingId`: a leitura roda sem `app.wedding_id` (revisão C2-2)
 * e não conta como atividade do casamento (revisão C2-8).
 */
@ApiTags('planner')
@Controller('me/weddings')
export class MyWeddingsController {
  constructor(
    private readonly listWeddings: ListMyWeddings,
    private readonly getWedding: GetMyWedding,
  ) {}

  @Get()
  @ApiErrorResponses(...commonErrors({ session: true }), ProfileNotOwnedErrorBody)
  async list(@CurrentSession() session: AuthenticatedSession): Promise<MyWeddingsResponse> {
    try {
      return MyWeddingsResponse.from({
        view: await this.listWeddings.execute({ userId: session.userId, now: new Date() }),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiErrorResponses(
    ...commonErrors({ session: true }),
    ProfileNotOwnedErrorBody,
    WeddingNotFoundErrorBody,
  )
  async detail(
    @CurrentSession() session: AuthenticatedSession,
    @Param(
      'id',
      new ParseUUIDPipe({ exceptionFactory: () => toHttpError(new WeddingNotFoundError()) }),
    )
    weddingId: string,
  ): Promise<MyWeddingDetailResponse> {
    try {
      return MyWeddingDetailResponse.from({
        detail: await this.getWedding.execute({
          userId: session.userId,
          weddingId,
          now: new Date(),
        }),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
