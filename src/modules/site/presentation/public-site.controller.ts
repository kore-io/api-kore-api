import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { isValidSlugFormat } from '../../access/domain/wedding-signup';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { Public } from '../../../shared/http/public.decorator';
import { SiteRoute } from '../../../shared/http/site-route.decorator';
import { validationError } from '../../../shared/http/validation-errors';
import { GetPublicSite, GetSiteLinkPreview } from '../application/public-site.use-cases';
import { StartPartySession } from '../application/start-party-session.use-case';
import { clearPartyCookie, setPartyCookie } from './party-cookie';
import {
  SiteDraftErrorBody,
  SiteLinkInvalidErrorBody,
  SiteNotFoundErrorBody,
} from './site-error.dto';
import { toHttpError } from './site-http-errors';
import {
  PartySessionBody,
  PartySessionResponse,
  PublicSiteResponse,
  SiteLinkPreviewResponse,
} from './public-site.dto';

/** Fora dos buscadores em todo o site do casal na F2 (Site público RN02). */
const NO_INDEX = 'noindex, nofollow';

/**
 * O site do casal, lido por kore.com.br (Site público RN04, RN05 e RN07). Sem
 * sessão: o SessionGuard ignora a sessão da origem do site, e a rota é pública.
 */
@ApiTags('sites')
@Controller('sites/:slug')
@SiteRoute()
@Public()
export class PublicSiteController {
  constructor(
    private readonly getSite: GetPublicSite,
    private readonly startPartySession: StartPartySession,
  ) {}

  /**
   * O site, com o recorte do visitante feito no servidor (RN05). Nenhum cache
   * pode guardar a resposta: a de um grupo não pode chegar a um visitante (RN03).
   */
  @Get()
  @ApiErrorResponses(...commonErrors({}), SiteNotFoundErrorBody, SiteDraftErrorBody)
  async get(
    @Param('slug') slug: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicSiteResponse> {
    // Os cabeçalhos valem também para os erros.
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Robots-Tag', NO_INDEX);
    try {
      const { view, staleCookie } = await this.getSite.execute({
        slug: slug.toLowerCase(),
        cookies: (request.cookies ?? {}) as Record<string, string | undefined>,
      });
      if (staleCookie) clearPartyCookie({ response, name: staleCookie });
      return view;
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /**
   * Troca o token do link do grupo pelo cookie assinado do grupo (RN06;
   * ADR-36). A página tira o token do endereço depois. Limite `party_link`:
   * 20 falhas por minuto por IP.
   */
  @Post('party-session')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, write: true }),
    SiteLinkInvalidErrorBody,
    SiteDraftErrorBody,
    SiteNotFoundErrorBody,
  )
  async partySession(
    @Param('slug') slug: string,
    @Body() body: PartySessionBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PartySessionResponse> {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Robots-Tag', NO_INDEX);
    try {
      const session = await this.startPartySession.execute({
        slug: slug.toLowerCase(),
        token: body.token,
        ip: request.ip ?? 'unknown',
      });
      setPartyCookie({ response, ...session.cookie });
      return { slug: session.slug, party: session.party };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}

/** A prévia do link, lida pela Pages Function de kore.com.br/<slug> (Site público RN09). */
@ApiTags('sites')
@Controller('public/sites/:slug')
@SiteRoute()
@Public()
export class SiteLinkPreviewController {
  constructor(private readonly getPreview: GetSiteLinkPreview) {}

  /** Cacheada 5 minutos, sem purga na F2 (decisão 207, item 10); sem dado de grupo. */
  @Get('preview')
  @ApiErrorResponses(...commonErrors({ validated: true }))
  async preview(
    @Param('slug') slug: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SiteLinkPreviewResponse> {
    response.setHeader('X-Robots-Tag', NO_INDEX);
    const normalized = slug.toLowerCase();
    if (!isValidSlugFormat({ slug: normalized }))
      throw validationError({
        errors: [{ path: 'slug', code: 'SLUG_INVALID_FORMAT', params: {} }],
      });
    response.setHeader('Cache-Control', 'public, max-age=300');
    return this.getPreview.execute({ slug: normalized });
  }
}
