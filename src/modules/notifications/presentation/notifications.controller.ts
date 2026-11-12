import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { validationError } from '../../../shared/http/validation-errors';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import { WeddingNotFoundErrorBody } from '../../access/presentation/access-error.dto';
import { toHttpError as toAccessHttpError } from '../../access/presentation/access-http-errors';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import {
  NotificationCenter,
  NotificationCursorInvalidError,
  NotificationNotFoundError,
  NotificationPreferences,
} from '../application/notifications.use-cases';
import {
  NotificationNotFoundErrorBody,
  NotificationsQuery,
  NotificationsResponse,
  PreferenceResponse,
  PreferencesResponse,
  SavePreferenceBody,
  UnreadCountResponse,
  WeddingQuery,
} from './notifications.dto';

function toHttpError(error: unknown): unknown {
  if (error instanceof NotificationNotFoundError)
    return new NotFoundException({
      statusCode: 404,
      error: 'NOTIFICATION_NOT_FOUND',
      message: 'Notification not found.',
    });
  if (error instanceof NotificationCursorInvalidError)
    return validationError({ errors: [{ path: 'cursor', code: 'INVALID_CURSOR', params: {} }] });
  return toAccessHttpError(error);
}

/** A central de notificações e as preferências de cada pessoa (F5). */
@ApiTags('notifications')
@Controller('me')
export class NotificationsController {
  constructor(
    private readonly center: NotificationCenter,
    private readonly preferences: NotificationPreferences,
  ) {}

  /** A página Notificações do casamento ativo (Central RN06). */
  @Get('notifications')
  @ApiErrorResponses(...commonErrors({ validated: true, session: true }), WeddingNotFoundErrorBody)
  async list(
    @CurrentSession() session: AuthenticatedSession,
    @Query() query: NotificationsQuery,
  ): Promise<NotificationsResponse> {
    try {
      const page = await this.center.list({
        userId: session.userId,
        weddingId: query.weddingId,
        type: query.type ?? null,
        cursor: query.cursor,
      });
      return {
        nextCursor: page.nextCursor,
        items: page.items.map((row) => ({
          ...row,
          payload: row.payload as NotificationsResponse['items'][number]['payload'],
          readAt: row.readAt?.toISOString() ?? null,
          updatedAt: row.updatedAt.toISOString(),
        })),
      };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** O contador do sino, a cada 60 s com a aba visível (Central RN06; R7-5). */
  @Get('notifications/unread-count')
  @ApiErrorResponses(...commonErrors({ validated: true, session: true }), WeddingNotFoundErrorBody)
  async unread(
    @CurrentSession() session: AuthenticatedSession,
    @Query() query: WeddingQuery,
  ): Promise<UnreadCountResponse> {
    try {
      return {
        unreadCount: await this.center.unreadCount({
          userId: session.userId,
          weddingId: query.weddingId,
        }),
      };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Marcar todas como lidas (Central RN06). */
  @Post('notifications/read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    WeddingNotFoundErrorBody,
  )
  async readAll(
    @CurrentSession() session: AuthenticatedSession,
    @Query() query: WeddingQuery,
  ): Promise<void> {
    try {
      await this.center.readAll({
        userId: session.userId,
        weddingId: query.weddingId,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Abrir marca como lida (Central RN05). */
  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    NotificationNotFoundErrorBody,
  )
  async read(
    @CurrentSession() session: AuthenticatedSession,
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          validationError({ errors: [{ path: 'id', code: 'IS_UUID', params: {} }] }),
      }),
    )
    id: string,
  ): Promise<void> {
    try {
      await this.center.read({ userId: session.userId, id, now: new Date() });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Configurações › Notificações (Central RN07). */
  @Get('notification-preferences')
  @ApiErrorResponses(...commonErrors({ validated: true, session: true }), WeddingNotFoundErrorBody)
  async getPreferences(
    @CurrentSession() session: AuthenticatedSession,
    @Query() query: WeddingQuery,
  ): Promise<PreferencesResponse> {
    try {
      return await this.preferences.get({
        userId: session.userId,
        sessionId: session.sessionId,
        weddingId: query.weddingId,
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Grava o e-mail de um tipo, na hora (Central RN07). */
  @Put('notification-preferences')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    WeddingNotFoundErrorBody,
  )
  async savePreference(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: SavePreferenceBody,
  ): Promise<PreferenceResponse> {
    try {
      return await this.preferences.saveEmail({
        userId: session.userId,
        weddingId: body.weddingId,
        type: body.type,
        email: body.email,
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
