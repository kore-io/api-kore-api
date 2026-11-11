import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { isValidSlugFormat } from '../../access/domain/wedding-signup';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { Public } from '../../../shared/http/public.decorator';
import { SiteRoute } from '../../../shared/http/site-route.decorator';
import { validationError } from '../../../shared/http/validation-errors';
import { GetPublicSite, GetSiteLinkPreview } from '../application/public-site.use-cases';
import { SiteDraftErrorBody, SiteNotFoundErrorBody } from './site-error.dto';
import { toHttpError } from './site-http-errors';
import { PublicSiteResponse, SiteLinkPreviewResponse } from './public-site.dto';

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
  constructor(private readonly getSite: GetPublicSite) {}

  /**
   * O site, com o recorte do visitante feito no servidor (RN05). Nenhum cache
   * pode guardar a resposta: a de um grupo não pode chegar a um visitante (RN03).
   */
  @Get()
  @ApiErrorResponses(...commonErrors({}), SiteNotFoundErrorBody, SiteDraftErrorBody)
  async get(
    @Param('slug') slug: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicSiteResponse> {
    // Os cabeçalhos valem também para os erros.
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Robots-Tag', NO_INDEX);
    try {
      return await this.getSite.execute({ slug: slug.toLowerCase() });
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
