import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags } from '@nestjs/swagger';
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
import { ApplyTag, CreateTag, ListTags, UpdateTag } from '../application/tags.use-cases';
import { TrashTag } from '../application/trash.use-cases';
import { TrashedTagResponse } from './trash.dto';
import { TagNotFoundError } from '../domain/guests.errors';
import {
  TagLimitReachedErrorBody,
  TagNameTakenErrorBody,
  TagNotFoundErrorBody,
} from './guests-error.dto';
import { toHttpError } from './guests-http-errors';
import {
  ApplyTagBody,
  ApplyTagResponse,
  CreateTagBody,
  TagListResponse,
  TagResponse,
  UpdateTagBody,
} from './tags.dto';

@ApiTags('tags')
@Controller('weddings/:weddingId/tags')
export class TagsController {
  constructor(
    private readonly listTags: ListTags,
    private readonly createTag: CreateTag,
    private readonly updateTag: UpdateTag,
    private readonly applyTag: ApplyTag,
    private readonly trashTag: TrashTag,
  ) {}

  /** Excluir a tag: vai para a lixeira, com os vínculos guardados (Lixeira RN05). */
  @Delete(':tagId')
  @ApiErrorResponses(
    ...commonErrors({ session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    TagNotFoundErrorBody,
  )
  async trash(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Param(
      'tagId',
      new ParseUUIDPipe({ exceptionFactory: () => toHttpError(new TagNotFoundError()) }),
    )
    tagId: string,
    @Req() request: Request,
  ): Promise<TrashedTagResponse> {
    try {
      const tag = await this.trashTag.execute({
        userId: session.userId,
        weddingId,
        tagId,
        ip: request.ip ?? null,
        now: new Date(),
      });
      return { ...tag, deletedAt: tag.deletedAt.toISOString() };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Tela Tags, Novo grupo e filtro da lista (Tags RN04, RN05). */
  @Get()
  @ApiErrorResponses(...commonErrors({ session: true }), WeddingNotFoundErrorBody)
  async list(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
  ): Promise<TagListResponse> {
    try {
      return await this.listTags.execute({ userId: session.userId, weddingId });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Criar tag (Tags RN01 a RN03). */
  @Post()
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    TagLimitReachedErrorBody,
    TagNameTakenErrorBody,
  )
  async create(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: CreateTagBody,
  ): Promise<TagResponse> {
    try {
      return await this.createTag.execute({
        userId: session.userId,
        weddingId,
        name: body.name,
        color: body.color,
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Editar tag: renomear e trocar a cor (Tags RN06). */
  @Patch(':tagId')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    TagNotFoundErrorBody,
    TagNameTakenErrorBody,
  )
  async update(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Param(
      'tagId',
      new ParseUUIDPipe({ exceptionFactory: () => toHttpError(new TagNotFoundError()) }),
    )
    tagId: string,
    @Body() body: UpdateTagBody,
  ): Promise<TagResponse> {
    try {
      return await this.updateTag.execute({
        userId: session.userId,
        weddingId,
        tagId,
        name: body.name,
        color: body.color,
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Seleção múltipla, Adicionar tag: só grupos (Tags RN08). */
  @Post(':tagId/apply')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    TagNotFoundErrorBody,
  )
  async apply(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Param(
      'tagId',
      new ParseUUIDPipe({ exceptionFactory: () => toHttpError(new TagNotFoundError()) }),
    )
    tagId: string,
    @Body() body: ApplyTagBody,
  ): Promise<ApplyTagResponse> {
    try {
      return await this.applyTag.execute({
        userId: session.userId,
        weddingId,
        tagId,
        partyIds: body.partyIds,
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
