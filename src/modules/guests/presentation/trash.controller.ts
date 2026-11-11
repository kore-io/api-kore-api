import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import {
  ActionNotAllowedErrorBody,
  WeddingNotFoundErrorBody,
} from '../../access/presentation/access-error.dto';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import { ListTrash, RestoreTrashItem } from '../application/trash.use-cases';
import {
  TagLimitReachedErrorBody,
  TagNameTakenErrorBody,
  TrashItemNotFoundErrorBody,
} from './guests-error.dto';
import { toHttpError } from './guests-http-errors';
import { RestoreTrashItemBody, RestoreTrashItemResponse, TrashListResponse } from './trash.dto';

@ApiTags('trash')
@Controller('weddings/:weddingId/trash')
export class TrashController {
  constructor(
    private readonly listTrash: ListTrash,
    private readonly restoreItem: RestoreTrashItem,
  ) {}

  /** A tela Lixeira: todo item ainda não expurgado (Lixeira RN08). */
  @Get()
  @ApiErrorResponses(...commonErrors({ session: true }), WeddingNotFoundErrorBody)
  async list(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
  ): Promise<TrashListResponse> {
    try {
      return TrashListResponse.from({
        rows: await this.listTrash.execute({ userId: session.userId, weddingId }),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Restaurar um item como estava (Lixeira RN09). */
  @Post('restore')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    TrashItemNotFoundErrorBody,
    TagLimitReachedErrorBody,
    TagNameTakenErrorBody,
  )
  async restore(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: RestoreTrashItemBody,
    @Req() request: Request,
  ): Promise<RestoreTrashItemResponse> {
    try {
      return RestoreTrashItemResponse.from({
        result: await this.restoreItem.execute({
          userId: session.userId,
          weddingId,
          type: body.type,
          id: body.id,
          ip: request.ip ?? null,
        }),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
