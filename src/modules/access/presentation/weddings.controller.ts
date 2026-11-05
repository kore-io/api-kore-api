import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { CheckSlugAvailability } from '../application/check-slug-availability.use-case';
import { CreateWedding } from '../application/create-wedding.use-case';
import type { AuthenticatedSession } from '../domain/authenticated-session';
import {
  AlreadyOwnerErrorBody,
  SlugUnavailableErrorBody,
  TermsVersionOutdatedErrorBody,
} from './access-error.dto';
import { toHttpError } from './access-http-errors';
import { CurrentSession } from './current-session.decorator';
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
  ) {}

  /** Confere o endereço enquanto o casal digita (RN04, RN05 de Cadastro). */
  @Get('slug-availability')
  @ApiErrorResponses(...commonErrors({ validated: true, session: true }))
  async slugAvailability(@Query() query: SlugAvailabilityQuery): Promise<SlugAvailabilityResponse> {
    const availability = await this.checkSlugAvailability.execute({
      slug: query.slug,
      eventDate: toDate(query.eventDate),
    });
    return SlugAvailabilityResponse.from({ availability });
  }

  /** Cria o casamento em rascunho, com a pessoa como dona (RN02 a RN09, RN11 de Cadastro). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    SlugUnavailableErrorBody,
    AlreadyOwnerErrorBody,
    TermsVersionOutdatedErrorBody,
  )
  async create(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: CreateWeddingBody,
  ): Promise<CreateWeddingResponse> {
    try {
      const wedding = await this.createWedding.execute({
        userId: session.userId,
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
        },
      });
      return CreateWeddingResponse.from({ wedding });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
