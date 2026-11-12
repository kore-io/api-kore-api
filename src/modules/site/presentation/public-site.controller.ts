import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
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
import { clearPartyCookie, setPartyCookie, setPreviewCookie } from './party-cookie';
import {
  ListPreviewParties,
  StartPreviewSession,
  UpdatePreviewSession,
} from '../application/site-preview.use-cases';
import {
  PreviewInvalidErrorBody,
  PreviewRequiredErrorBody,
  SiteDraftErrorBody,
  SiteLinkInvalidErrorBody,
  SiteNotFoundErrorBody,
  SitePartyNotFoundErrorBody,
} from './site-error.dto';
import { toHttpError } from './site-http-errors';
import {
  PreviewModeBody,
  PreviewModeResponse,
  PreviewPartiesQuery,
  PreviewPartiesResponse,
  PreviewSessionBody,
  PreviewSessionResponse,
  PartySessionBody,
  PartySessionResponse,
  PublicSiteResponse,
  SiteLinkPreviewResponse,
} from './public-site.dto';

/** Fora dos buscadores em todo o site do casal na F2 (Site público RN02). */
const NO_INDEX = 'noindex, nofollow';

/** Nenhum cache guarda as respostas com dado de grupo ou da prévia (RN03). */
function noCache(response: Response): void {
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Robots-Tag', NO_INDEX);
}

const cookiesOf = (request: Request) =>
  (request.cookies ?? {}) as Record<string, string | undefined>;

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
    private readonly startPreviewSession: StartPreviewSession,
    private readonly updatePreviewSession: UpdatePreviewSession,
    private readonly listPreviewParties: ListPreviewParties,
  ) {}

  /**
   * Troca o token da prévia pelo cookie da prévia, de 30 minutos fixos
   * (Pré-visualização RN03 e RN04). O site chama uma vez só por carregamento.
   */
  @Post('preview-session')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(...commonErrors({ validated: true, write: true }), PreviewInvalidErrorBody)
  async previewSession(
    @Param('slug') slug: string,
    @Body() body: PreviewSessionBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PreviewSessionResponse> {
    noCache(response);
    try {
      const session = await this.startPreviewSession.execute({
        slug: slug.toLowerCase(),
        token: body.token,
        ip: request.ip ?? 'unknown',
        now: new Date(),
      });
      setPreviewCookie({ response, ...session.cookie });
      return { slug: session.slug, mode: session.mode, party: session.party };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Troca o modo da prévia pela barra, sem estender os 30 minutos (Pré-visualização RN06). */
  @Patch('preview-session')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, write: true }),
    PreviewRequiredErrorBody,
    SitePartyNotFoundErrorBody,
  )
  async changePreview(
    @Param('slug') slug: string,
    @Body() body: PreviewModeBody,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PreviewModeResponse> {
    noCache(response);
    try {
      const session = await this.updatePreviewSession.execute({
        slug: slug.toLowerCase(),
        cookies: cookiesOf(request),
        mode: body.mode,
        partyId: body.partyId ?? null,
        now: new Date(),
      });
      setPreviewCookie({ response, ...session.cookie });
      return { mode: session.mode, party: session.party };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Os grupos para o Select da barra da prévia, até 100 (Pré-visualização RN06; decisão 203). */
  @Get('preview-parties')
  @ApiErrorResponses(...commonErrors({ validated: true }), PreviewRequiredErrorBody)
  async previewParties(
    @Param('slug') slug: string,
    @Query() query: PreviewPartiesQuery,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PreviewPartiesResponse> {
    noCache(response);
    try {
      return await this.listPreviewParties.execute({
        slug: slug.toLowerCase(),
        cookies: cookiesOf(request),
        q: query.q?.trim() || null,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

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
        cookies: cookiesOf(request),
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
