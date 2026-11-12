import { Body, Controller, Get, Param, Put, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { Public } from '../../../shared/http/public.decorator';
import { SiteRoute } from '../../../shared/http/site-route.decorator';
import { SiteDraftErrorBody, SiteNotFoundErrorBody } from '../../site/presentation/site-error.dto';
import { GetRsvp, SubmitRsvp } from '../application/rsvp.use-cases';
import { toHttpError } from './rsvp-http-errors';
import {
  PartySessionInvalidErrorBody,
  PreviewReadOnlyErrorBody,
  PutRsvpBody,
  RsvpChangedErrorBody,
  RsvpClosedErrorBody,
  RsvpRateLimitedErrorBody,
  RsvpResponse,
} from './rsvp.dto';

const cookiesOf = (request: Request) =>
  (request.cookies ?? {}) as Record<string, string | undefined>;

/** Nenhum cache guarda as respostas do grupo; o site segue fora dos buscadores (RN13). */
function noCache(response: Response): void {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

/**
 * Confirmar presença (F4), no site do casal: só o grupo identificado pelo
 * cookie, ou a prévia como grupo, só para leitura. Rotas do site (CORS e
 * OriginGuard da S5 RN07); sem sessão.
 */
@ApiTags('sites')
@Controller('sites/:slug/rsvp')
@SiteRoute()
@Public()
export class RsvpController {
  constructor(
    private readonly getRsvp: GetRsvp,
    private readonly submitRsvp: SubmitRsvp,
  ) {}

  /** O formulário com as respostas atuais (RN03 e RN08). */
  @Get()
  @ApiErrorResponses(
    ...commonErrors({}),
    PartySessionInvalidErrorBody,
    SiteNotFoundErrorBody,
    SiteDraftErrorBody,
  )
  async get(
    @Param('slug') slug: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RsvpResponse> {
    noCache(response);
    try {
      return await this.getRsvp.execute({
        slug: slug.toLowerCase(),
        cookies: cookiesOf(request),
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Grava as respostas do grupo (RN04 a RN13). */
  @Put()
  @ApiErrorResponses(
    ...commonErrors({ validated: true, write: true }),
    PartySessionInvalidErrorBody,
    PreviewReadOnlyErrorBody,
    RsvpChangedErrorBody,
    RsvpClosedErrorBody,
    RsvpRateLimitedErrorBody,
    SiteNotFoundErrorBody,
    SiteDraftErrorBody,
  )
  async put(
    @Param('slug') slug: string,
    @Body() body: PutRsvpBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RsvpResponse> {
    noCache(response);
    try {
      return await this.submitRsvp.execute({
        slug: slug.toLowerCase(),
        cookies: cookiesOf(request),
        version: body.version,
        signedByGuestId: body.signedByGuestId,
        answers: body.guests,
        ip: request.ip ?? 'unknown',
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
