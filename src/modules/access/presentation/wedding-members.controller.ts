import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { ListWeddingMembers } from '../application/list-wedding-members.use-case';
import { RemoveMembership } from '../application/remove-membership.use-case';
import { MembershipNotFoundError } from '../domain/access.errors';
import type { AuthenticatedSession } from '../domain/authenticated-session';
import {
  ActionNotAllowedErrorBody,
  CannotRemoveOwnerErrorBody,
  LastOwnerErrorBody,
  MembershipNotFoundErrorBody,
  WeddingNotFoundErrorBody,
} from './access-error.dto';
import { toHttpError } from './access-http-errors';
import { CurrentSession } from './current-session.decorator';
import { WeddingMembersResponse } from './wedding-members.dto';

@ApiTags('memberships')
@Controller('weddings/:weddingId/memberships')
export class WeddingMembersController {
  constructor(
    private readonly listMembers: ListWeddingMembers,
    private readonly removeMembership: RemoveMembership,
  ) {}

  /** Quem tem acesso e os convites pendentes, para Colaboradores (RN02, RN05 de Papéis). */
  @Get()
  @ApiErrorResponses(...commonErrors({ session: true }), WeddingNotFoundErrorBody)
  async list(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
  ): Promise<WeddingMembersResponse> {
    try {
      return WeddingMembersResponse.from(
        await this.listMembers.execute({ userId: session.userId, weddingId }),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Remove o colaborador ou encerra o próprio vínculo (RN06, RN07, RN10 de Papéis). */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiErrorResponses(
    ...commonErrors({ session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    MembershipNotFoundErrorBody,
    CannotRemoveOwnerErrorBody,
    LastOwnerErrorBody,
  )
  async remove(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Param(
      'id',
      new ParseUUIDPipe({ exceptionFactory: () => toHttpError(new MembershipNotFoundError()) }),
    )
    membershipId: string,
    @Req() request: Request,
  ): Promise<void> {
    try {
      await this.removeMembership.execute({
        userId: session.userId,
        weddingId,
        membershipId,
        ip: request.ip ?? null,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
