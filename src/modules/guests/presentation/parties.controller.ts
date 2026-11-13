import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { UpdateParty } from '../application/update-party.use-case';
import { TrashParties, TrashParty } from '../application/trash.use-cases';
import { TrashPartiesBody, TrashPartiesResponse, TrashedPartyResponse } from './trash.dto';
import { PartyNotFoundError } from '../domain/guests.errors';
import {
  AlreadyRespondedErrorBody,
  PartyNotFoundErrorBody,
  PlusOnesInUseErrorBody,
} from './guests-error.dto';
import { toHttpError } from './guests-http-errors';
import {
  CreatePartyBody,
  ListPartiesQuery,
  PartyListResponse,
  PartyResponse,
  RegeneratePartyLinkResponse,
  UpdatePartyBody,
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
    private readonly updateParty: UpdateParty,
    private readonly trashParty: TrashParty,
    private readonly trashParties: TrashParties,
  ) {}

  /** Seleção múltipla, Mover para a lixeira (Lixeira RN06 e RN07). */
  @Post('trash')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
  )
  async trashMany(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: TrashPartiesBody,
    @Req() request: Request,
  ): Promise<TrashPartiesResponse> {
    try {
      return await this.trashParties.execute({
        userId: session.userId,
        weddingId,
        partyIds: body.partyIds,
        ip: request.ip ?? null,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Mover o grupo para a lixeira, com os convidados dele (Lixeira RN03 e RN07). */
  @Delete(':partyId')
  @ApiErrorResponses(
    ...commonErrors({ session: true, write: true }),
    ActionNotAllowedErrorBody,
    AlreadyRespondedErrorBody,
    WeddingNotFoundErrorBody,
    PartyNotFoundErrorBody,
  )
  async trash(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Param('partyId', partyIdPipe) partyId: string,
    @Req() request: Request,
  ): Promise<TrashedPartyResponse> {
    try {
      const party = await this.trashParty.execute({
        userId: session.userId,
        weddingId,
        partyId,
        ip: request.ip ?? null,
        now: new Date(),
      });
      return { ...party, deletedAt: party.deletedAt.toISOString() };
    } catch (error) {
      throw toHttpError(error);
    }
  }

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
          remind: query.remind === 'true',
          saveTheDate: query.saveTheDate,
          order: query.order,
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

  /** Editar grupo (Grupos RN09): não tira convidado; vale a última gravação. */
  @Patch(':partyId')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    PartyNotFoundErrorBody,
    PlusOnesInUseErrorBody,
  )
  async update(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Param('partyId', partyIdPipe) partyId: string,
    @Body() body: UpdatePartyBody,
    @Req() request: Request,
  ): Promise<PartyResponse> {
    try {
      return PartyResponse.from({
        party: await this.updateParty.execute({
          userId: session.userId,
          weddingId,
          partyId,
          name: body.name,
          internalNote: body.internalNote,
          guests: body.guests,
          contactGuestId: body.contactGuestId,
          plusOneSlots: body.plusOneSlots,
          tagIds: body.tagIds,
          ip: request.ip ?? null,
          now: new Date(),
        }),
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
