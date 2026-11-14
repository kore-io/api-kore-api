import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { validationError } from '../../../shared/http/validation-errors';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import { WeddingNotFoundErrorBody } from '../../access/presentation/access-error.dto';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import { OwnTransactions } from '../../access/presentation/own-transactions.decorator';
import { SupportSessions } from '../application/support-sessions.use-cases';
import type { StaffMember } from '../domain/staff';
import { AdminReasonBody } from './admin-weddings.dto';
import {
  NoOwnerErrorBody,
  StaffOnlyErrorBody,
  SupportSessionNotFoundErrorBody,
} from './backoffice-error.dto';
import { toHttpError } from './backoffice-http-errors';
import { CurrentStaff, StaffGuard } from './staff.guard';

const uuidPipe = (path: string) =>
  new ParseUUIDPipe({
    exceptionFactory: () => validationError({ errors: [{ path, code: 'IS_UUID', params: {} }] }),
  });

export class SupportSessionResponse {
  @ApiProperty({ format: 'uuid' }) supportSessionId: string;
  @ApiProperty({ format: 'uuid' }) weddingId: string;
  @ApiProperty({ format: 'date-time' }) startedAt: string;
  /** Sem nova requisição, acaba aqui (30 minutos sem uso, teto de 2 horas). */
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
}

export class SupportSessionEndedResponse {
  @ApiProperty({ enum: ['ended'] }) status: 'ended';
}

/** Ver como o casal (Backoffice - acesso RN08): abrir e sair. */
@ApiTags('admin')
@Controller('admin')
@UseGuards(StaffGuard)
export class SupportSessionsController {
  constructor(private readonly sessions: SupportSessions) {}

  @Post('weddings/:id/support-sessions')
  @OwnTransactions()
  @ApiCreatedResponse({ type: SupportSessionResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    WeddingNotFoundErrorBody,
    NoOwnerErrorBody,
  )
  async start(
    @CurrentStaff() staff: StaffMember,
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', uuidPipe('id')) weddingId: string,
    @Body() body: AdminReasonBody,
  ): Promise<SupportSessionResponse> {
    try {
      const started = await this.sessions.start({
        staff,
        sessionId: session.sessionId,
        weddingId,
        reason: body.reason,
        now: new Date(),
      });
      return {
        ...started,
        startedAt: started.startedAt.toISOString(),
        expiresAt: started.expiresAt.toISOString(),
      };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  @Post('support-sessions/:id/end')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SupportSessionEndedResponse })
  @ApiErrorResponses(
    ...commonErrors({ session: true, write: true }),
    StaffOnlyErrorBody,
    SupportSessionNotFoundErrorBody,
  )
  async end(
    @CurrentStaff() staff: StaffMember,
    @Param('id', uuidPipe('id')) supportSessionId: string,
  ): Promise<SupportSessionEndedResponse> {
    try {
      await this.sessions.end({ staff, supportSessionId, now: new Date() });
      return { status: 'ended' };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
