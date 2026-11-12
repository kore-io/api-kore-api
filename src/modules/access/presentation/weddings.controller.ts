import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { ContrastTooLowErrorBody } from '../../site/presentation/site-error.dto';
import { CheckSlugAvailability } from '../application/check-slug-availability.use-case';
import { CreateWedding } from '../application/create-wedding.use-case';
import { DeleteWeddingByCreator } from '../application/delete-wedding-by-creator.use-case';
import type { AuthenticatedSession } from '../domain/authenticated-session';
import {
  ActionNotAllowedErrorBody,
  AlreadyOwnerErrorBody,
  SlugUnavailableErrorBody,
  TermsVersionOutdatedErrorBody,
  WeddingHasOwnerErrorBody,
  WeddingNotFoundErrorBody,
} from './access-error.dto';
import { toHttpError } from './access-http-errors';
import { CurrentSession } from './current-session.decorator';
import { OwnTransactions } from './own-transactions.decorator';
import {
  CreateWeddingBody,
  CreateWeddingResponse,
  SlugAvailabilityQuery,
  SlugAvailabilityResponse,
} from './weddings.dto';

const toDate = (value: string | undefined): Date | null =>
  value ? new Date(`${value}T00:00:00Z`) : null;

@ApiTags('weddings')
@Controller('weddings')
export class WeddingsController {
  constructor(
    private readonly checkSlugAvailability: CheckSlugAvailability,
    private readonly createWedding: CreateWedding,
    private readonly deleteWedding: DeleteWeddingByCreator,
  ) {}

  /**
   * Excluir este casamento (Meus casamentos RN11): só a cerimonialista que o
   * criou, em rascunho ou aguardando o casal, sem dono ativo. Abre as próprias
   * transações: a autorização sob a RLS e a exclusão pelo backoffice.
   */
  @Delete(':weddingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @OwnTransactions()
  @ApiErrorResponses(
    ...commonErrors({ session: true, write: true }),
    WeddingNotFoundErrorBody,
    ActionNotAllowedErrorBody,
    WeddingHasOwnerErrorBody,
  )
  async remove(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
  ): Promise<void> {
    try {
      await this.deleteWedding.execute({ userId: session.userId, weddingId, now: new Date() });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Confere o endereço enquanto o casal digita (RN04, RN05 de Cadastro). */
  @Get('slug-availability')
  @ApiErrorResponses(...commonErrors({ validated: true, session: true }))
  async slugAvailability(@Query() query: SlugAvailabilityQuery): Promise<SlugAvailabilityResponse> {
    const availability = await this.checkSlugAvailability.execute({
      slug: query.slug,
      eventDate: toDate(query.eventDate),
      weddingId: query.weddingId,
    });
    return SlugAvailabilityResponse.from({ availability });
  }

  /**
   * Cria o casamento em rascunho, com a pessoa como dona (RN02 a RN09, RN11 de
   * Cadastro), e passa a sessão ao perfil de casal (activeProfile couple,
   * decisão 171). Nos erros, a sessão não muda.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    SlugUnavailableErrorBody,
    AlreadyOwnerErrorBody,
    TermsVersionOutdatedErrorBody,
    ContrastTooLowErrorBody,
  )
  async create(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: CreateWeddingBody,
  ): Promise<CreateWeddingResponse> {
    try {
      const wedding = await this.createWedding.execute({
        userId: session.userId,
        sessionId: session.sessionId,
        now: new Date(),
        signup: {
          myName: body.myName,
          myTitle: body.myTitle,
          partnerName: body.partnerName,
          eventDate: toDate(body.eventDate),
          city: body.city,
          state: body.state,
          slug: body.slug,
          referralCode: body.referralCode ?? null,
          termsVersion: body.termsVersion,
          signupSource: body.signupSource ?? null,
          utmSource: body.utmSource ?? null,
          utmMedium: body.utmMedium ?? null,
          utmCampaign: body.utmCampaign ?? null,
          appearance: body.appearance ?? null,
        },
      });
      return CreateWeddingResponse.from({ wedding });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
