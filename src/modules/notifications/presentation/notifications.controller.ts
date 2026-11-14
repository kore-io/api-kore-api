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
import {
  ProfileNotOwnedErrorBody,
  WeddingNotFoundErrorBody,
} from '../../access/presentation/access-error.dto';
import { toHttpError as toAccessHttpError } from '../../access/presentation/access-http-errors';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import {
  type CenterNotificationType,
  EMAIL_PREFERENCE_TYPES,
  NOTIFICATION_TYPES,
  PLANNER_CENTER_TYPES,
  type NotificationType,
  type PlannerNotificationType,
  type PreferenceRow,
} from '../application/ports/notification-store.port';
import {
  EmailPreferenceNotEditableError,
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
  PreferencesQuery,
  UnreadCountResponse,
  WeddingQuery,
} from './notifications.dto';

/**
 * O escopo do pedido (Notificações da cerimonialista RN05; revisão C8-5): com
 * `scope=planner`, a central dela e sem `weddingId`; sem `scope`, o casamento
 * ativo. Na central do casal, só os tipos dela.
 */
function scopeOf({
  weddingId,
  scope,
  type,
}: {
  weddingId?: string;
  scope?: 'planner';
  type?: CenterNotificationType;
}): { planner: true } | { planner: false; weddingId: string } {
  if (scope === 'planner') {
    if (weddingId !== undefined)
      throw validationError({
        errors: [{ path: 'weddingId', code: 'NOT_ALLOWED', params: {} }],
      });
    if (type !== undefined && !(PLANNER_CENTER_TYPES as readonly string[]).includes(type))
      throw validationError({
        errors: [{ path: 'type', code: 'IS_IN', params: { values: [...PLANNER_CENTER_TYPES] } }],
      });
    return { planner: true };
  }
  if (type !== undefined && !(NOTIFICATION_TYPES as readonly string[]).includes(type))
    throw validationError({
      errors: [{ path: 'type', code: 'IS_IN', params: { values: [...NOTIFICATION_TYPES] } }],
    });
  return { planner: false, weddingId: weddingId ?? '' };
}

/** O e-mail fixo em "Sempre" não tem seletor (decisão 236). */
function toPreference(row: PreferenceRow): PreferenceResponse {
  return { ...row, emailEditable: row.email !== 'always' };
}

function toHttpError(error: unknown): unknown {
  if (error instanceof NotificationNotFoundError)
    return new NotFoundException({
      statusCode: 404,
      error: 'NOTIFICATION_NOT_FOUND',
      message: 'Notification not found.',
    });
  if (error instanceof EmailPreferenceNotEditableError)
    return validationError({ errors: [{ path: 'type', code: 'NOT_EDITABLE', params: {} }] });
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

  /**
   * A página Notificações do casamento ativo (Central RN06), ou a da
   * cerimonialista com `scope=planner` (Notificações da cerimonialista RN05).
   */
  @Get('notifications')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true }),
    WeddingNotFoundErrorBody,
    ProfileNotOwnedErrorBody,
  )
  async list(
    @CurrentSession() session: AuthenticatedSession,
    @Query() query: NotificationsQuery,
  ): Promise<NotificationsResponse> {
    const target = scopeOf(query);
    try {
      const page = target.planner
        ? await this.center.listPlanner({
            userId: session.userId,
            type: (query.type as PlannerNotificationType | undefined) ?? null,
            cursor: query.cursor,
          })
        : await this.center.list({
            userId: session.userId,
            weddingId: target.weddingId,
            type: (query.type as NotificationType | undefined) ?? null,
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
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true }),
    WeddingNotFoundErrorBody,
    ProfileNotOwnedErrorBody,
  )
  async unread(
    @CurrentSession() session: AuthenticatedSession,
    @Query() query: WeddingQuery,
  ): Promise<UnreadCountResponse> {
    const target = scopeOf(query);
    try {
      return {
        unreadCount: target.planner
          ? await this.center.unreadCountPlanner({ userId: session.userId })
          : await this.center.unreadCount({ userId: session.userId, weddingId: target.weddingId }),
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
    ProfileNotOwnedErrorBody,
  )
  async readAll(
    @CurrentSession() session: AuthenticatedSession,
    @Query() query: WeddingQuery,
  ): Promise<void> {
    const target = scopeOf(query);
    try {
      if (target.planner)
        await this.center.readAllPlanner({ userId: session.userId, now: new Date() });
      else
        await this.center.readAll({
          userId: session.userId,
          weddingId: target.weddingId,
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

  /**
   * Configurações › Notificações (Central RN07). Sem `weddingId`, a preferência
   * geral da cerimonialista (Notificações da cerimonialista RN06).
   */
  @Get('notification-preferences')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true }),
    WeddingNotFoundErrorBody,
    ProfileNotOwnedErrorBody,
  )
  async getPreferences(
    @CurrentSession() session: AuthenticatedSession,
    @Query() query: PreferencesQuery,
  ): Promise<PreferencesResponse> {
    try {
      const view =
        query.weddingId === undefined
          ? await this.preferences.getGeneral({
              userId: session.userId,
              sessionId: session.sessionId,
            })
          : await this.preferences.get({
              userId: session.userId,
              sessionId: session.sessionId,
              weddingId: query.weddingId,
            });
      return { ...view, items: view.items.map((row) => toPreference(row)) };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Grava o e-mail de um tipo, na hora (Central RN07). */
  @Put('notification-preferences')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    WeddingNotFoundErrorBody,
    ProfileNotOwnedErrorBody,
  )
  async savePreference(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: SavePreferenceBody,
  ): Promise<PreferenceResponse> {
    if (
      body.weddingId !== undefined &&
      !(EMAIL_PREFERENCE_TYPES as readonly string[]).includes(body.type)
    )
      throw validationError({
        errors: [{ path: 'type', code: 'IS_IN', params: { values: [...EMAIL_PREFERENCE_TYPES] } }],
      });
    try {
      const row =
        body.weddingId === undefined
          ? await this.preferences.saveGeneralEmail({
              userId: session.userId,
              type: body.type,
              email: body.email,
            })
          : await this.preferences.saveEmail({
              userId: session.userId,
              weddingId: body.weddingId,
              type: body.type as NotificationType,
              email: body.email,
            });
      return toPreference(row);
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
