import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import {
  PushEndpointNotAllowedError,
  PushSubscriptions,
} from '../application/push-subscriptions.use-cases';
import {
  PushEndpointNotAllowedErrorBody,
  PushSubscriptionBody,
  PushUnsubscribeBody,
} from './notifications.dto';

/** O push deste aparelho (F5; E-mail e push RN07 e RN08). */
@ApiTags('notifications')
@Controller('me/push-subscriptions')
export class PushSubscriptionsController {
  constructor(private readonly subscriptions: PushSubscriptions) {}

  /** Liga o push neste aparelho: grava ou atualiza pelo endpoint, presa à sessão atual. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    PushEndpointNotAllowedErrorBody,
  )
  async subscribe(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: PushSubscriptionBody,
    @Req() request: Request,
  ): Promise<void> {
    try {
      await this.subscriptions.subscribe({
        userId: session.userId,
        sessionId: session.sessionId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: request.get('user-agent')?.slice(0, 512) ?? null,
      });
    } catch (error) {
      if (error instanceof PushEndpointNotAllowedError)
        throw new BadRequestException({
          statusCode: 400,
          error: 'PUSH_ENDPOINT_NOT_ALLOWED',
          message: 'This push endpoint is not allowed.',
        });
      throw error;
    }
  }

  /** Desliga o push neste aparelho. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiErrorResponses(...commonErrors({ validated: true, session: true, write: true }))
  async unsubscribe(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: PushUnsubscribeBody,
  ): Promise<void> {
    await this.subscriptions.unsubscribe({ userId: session.userId, endpoint: body.endpoint });
  }
}
