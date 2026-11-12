import { Body, Controller, Get, Param, ParseEnumPipe, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { validationError } from '../../../shared/http/validation-errors';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import {
  ActionNotAllowedErrorBody,
  WeddingNotFoundErrorBody,
} from '../../access/presentation/access-error.dto';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import {
  ListMessageTemplates,
  SaveMessageTemplate,
} from '../application/message-templates.use-cases';
import { MESSAGE_KINDS, type MessageKind } from '../domain/message-templates';
import {
  LinkPlaceholderMissingErrorBody,
  MessageTemplateResponse,
  MessageTemplatesResponse,
  SaveMessageTemplateBody,
} from './message-templates.dto';
import { toHttpError } from './rsvp-http-errors';

/** Mensagens prontas dos envios (F4; Envios RN06). */
@ApiTags('rsvp')
@Controller('weddings/:weddingId/message-templates')
export class MessageTemplatesController {
  constructor(
    private readonly list: ListMessageTemplates,
    private readonly save: SaveMessageTemplate,
  ) {}

  /** As três mensagens, com o padrão quando o casal não editou. */
  @Get()
  @ApiErrorResponses(
    ...commonErrors({ session: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
  )
  async all(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
  ): Promise<MessageTemplatesResponse> {
    try {
      return { items: await this.list.execute({ userId: session.userId, weddingId }) };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Grava a mensagem de um tipo, ou volta ao padrão com `reset`. */
  @Put(':kind')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    LinkPlaceholderMissingErrorBody,
  )
  async put(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Param(
      'kind',
      new ParseEnumPipe(Object.fromEntries(MESSAGE_KINDS.map((kind) => [kind, kind])), {
        exceptionFactory: () =>
          validationError({
            errors: [{ path: 'kind', code: 'IS_IN', params: { values: [...MESSAGE_KINDS] } }],
          }),
      }),
    )
    kind: MessageKind,
    @Body() body: SaveMessageTemplateBody,
  ): Promise<MessageTemplateResponse> {
    try {
      return await this.save.execute({
        userId: session.userId,
        weddingId,
        kind,
        input:
          body.reset === true
            ? { reset: true }
            : { subject: body.subject ?? null, body: body.body as string },
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
