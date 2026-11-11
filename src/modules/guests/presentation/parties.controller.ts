import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
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
import { CreateParty } from '../application/create-party.use-case';
import { GetParty } from '../application/get-party.use-case';
import { ListParties } from '../application/list-parties.use-case';
import { RegeneratePartyLink } from '../application/regenerate-party-link.use-case';
import { PartyNotFoundError } from '../domain/guests.errors';
import { PartyNotFoundErrorBody } from './guests-error.dto';
import { toHttpError } from './guests-http-errors';
import {
  CreatePartyBody,
  ListPartiesQuery,
  PartyListResponse,
  PartyResponse,
  RegeneratePartyLinkResponse,
} from './parties.dto';

const partyIdPipe = new ParseUUIDPipe({
  exceptionFactory: () => toHttpError(new PartyNotFoundError()),
});

@ApiTags('parties')
@Controller('weddings/:weddingId/parties')
export class PartiesController {
  constructor(
    private readonly createParty: CreateParty,
    private readonly getParty: GetParty,
    private readonly listParties: ListParties,
    private readonly regenerateLink: RegeneratePartyLink,
  ) {}

  /** Grupos e convidados, a lista (Grupos RN13). */
  @Get()
  @ApiErrorResponses(...commonErrors({ validated: true, session: true }), WeddingNotFoundErrorBody)
  async list(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Query() query: ListPartiesQuery,
  ): Promise<PartyListResponse> {
    try {
      return PartyListResponse.from({
        list: await this.listParties.execute({
          userId: session.userId,
          weddingId,
          q: query.q,
          rsvp: query.rsvp,
          sent: query.sent,
          tagId: query.tag,
          cursor: query.cursor,
          limit: query.limit,
        }),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Novo grupo, com os convidados, as vagas, as tags e a observação (Grupos RN03). */
  @Post()
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
  )
  async create(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: CreatePartyBody,
  ): Promise<PartyResponse> {
    try {
      return PartyResponse.from({
        party: await this.createParty.execute({
          userId: session.userId,
          weddingId,
          name: body.name,
          guests: body.guests,
          contactIndex: body.contactIndex,
          plusOneSlots: body.plusOneSlots,
          tagIds: body.tagIds,
          internalNote: body.internalNote,
          now: new Date(),
        }),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Painel do grupo e Editar grupo (Grupos RN14). */
  @Get(':partyId')
  @ApiErrorResponses(
    ...commonErrors({ session: true }),
    WeddingNotFoundErrorBody,
    PartyNotFoundErrorBody,
  )
  async get(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Param('partyId', partyIdPipe) partyId: string,
  ): Promise<PartyResponse> {
    try {
      return PartyResponse.from({
        party: await this.getParty.execute({ userId: session.userId, weddingId, partyId }),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Regenerar link: o antigo para na hora (Grupos RN12). */
  @Post(':partyId/regenerate-link')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(
    ...commonErrors({ session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    PartyNotFoundErrorBody,
  )
  async regenerate(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Param('partyId', partyIdPipe) partyId: string,
    @Req() request: Request,
  ): Promise<RegeneratePartyLinkResponse> {
    try {
      const { url, regeneratedAt } = await this.regenerateLink.execute({
        userId: session.userId,
        weddingId,
        partyId,
        ip: request.ip ?? null,
        now: new Date(),
      });
      return { url, regeneratedAt: regeneratedAt.toISOString() };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
