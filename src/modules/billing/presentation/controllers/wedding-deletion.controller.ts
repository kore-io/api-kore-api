import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiAcceptedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, commonErrors } from '@/shared/http/api-error-responses.decorator';
import type { AuthenticatedSession } from '@/modules/access/domain/sessions/authenticated-session';
import {
  ActionNotAllowedErrorBody,
  ReauthRequiredErrorBody,
  WeddingNotFoundErrorBody,
} from '@/modules/access/presentation/dto/access-error.dto';
import { AllowWhenBlocked } from '@/modules/access/presentation/http/decorators/allow-when-blocked.decorator';
import { CurrentSession } from '@/modules/access/presentation/http/decorators/current-session.decorator';
import { OwnTransactions } from '@/modules/access/presentation/http/decorators/own-transactions.decorator';
import {
  CancelWeddingDeletion,
  RequestWeddingDeletion,
} from '@/modules/billing/application/wedding-lifecycle/wedding-deletion.use-cases';
import {
  ConfirmNameMismatchErrorBody,
  NoDeletionScheduledErrorBody,
  PaymentDisputedErrorBody,
  RefundInProgressErrorBody,
  RefundWindowOpenErrorBody,
  WeddingBlockedErrorBody,
} from '@/modules/billing/presentation/dto/billing-error.dto';
import { toHttpError } from '@/modules/billing/presentation/errors/billing-http-errors';
import {
  WeddingDeletionBody,
  WeddingDeletionCanceledResponse,
  WeddingDeletionScheduledResponse,
  WeddingLifecycleResponse,
} from '@/modules/billing/presentation/dto/wedding-deletion.dto';

/**
 * Excluir o casamento e cancelar a exclusão (Retenção e expurgo RN05, RN06 e
 * RN08). As duas rotas passam pelo guard da exclusão agendada (o caso de uso
 * é idempotente e o cancelar existe para ela); o bloqueio o caso de uso confere.
 */
@ApiTags('billing')
@Controller('weddings/:weddingId/deletion')
export class WeddingDeletionController {
  constructor(
    private readonly requestDeletion: RequestWeddingDeletion,
    private readonly cancelDeletion: CancelWeddingDeletion,
  ) {}

  /** Excluir o casamento: o site sai do ar na hora e tudo é apagado em 7 dias. */
  @Post()
  @OwnTransactions()
  @AllowWhenBlocked()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({ type: WeddingDeletionScheduledResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ReauthRequiredErrorBody,
    WeddingBlockedErrorBody,
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    RefundWindowOpenErrorBody,
    RefundInProgressErrorBody,
    PaymentDisputedErrorBody,
    ConfirmNameMismatchErrorBody,
  )
  async request(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: WeddingDeletionBody,
  ): Promise<WeddingDeletionScheduledResponse> {
    try {
      return await this.requestDeletion.execute({
        session,
        weddingId,
        confirmName: body.confirmName,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Cancelar a exclusão: qualquer dono, até o expurgo. */
  @Post('cancel')
  @OwnTransactions()
  @AllowWhenBlocked()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: WeddingDeletionCanceledResponse })
  @ApiErrorResponses(
    ...commonErrors({ session: true, write: true }),
    WeddingBlockedErrorBody,
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    NoDeletionScheduledErrorBody,
  )
  async cancel(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
  ): Promise<WeddingDeletionCanceledResponse> {
    try {
      const view = await this.cancelDeletion.execute({
        userId: session.userId,
        weddingId,
        now: new Date(),
      });
      return { lifecycle: WeddingLifecycleResponse.from({ view }) };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
