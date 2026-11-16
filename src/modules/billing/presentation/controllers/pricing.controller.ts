import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, commonErrors } from '@/shared/http/api-error-responses.decorator';
import { Public } from '@/shared/http/public.decorator';
import type { AuthenticatedSession } from '@/modules/access/domain/authenticated-session';
import {
  ActionNotAllowedErrorBody,
  WeddingNotFoundErrorBody,
} from '@/modules/access/presentation/dto/access-error.dto';
import { CurrentSession } from '@/modules/access/presentation/http/decorators/current-session.decorator';
import {
  EndDateOutOfRangeErrorBody,
  EventDateMissingErrorBody,
  NotDraftErrorBody,
  SiteSlugMissingErrorBody,
} from '@/modules/site/presentation/dto/site-error.dto';
import { QuoteBilling } from '@/modules/billing/application/payments/quote-billing.use-case';
import { PrismaPublicPricingReader } from '@/modules/billing/infrastructure/persistence/prisma-public-pricing.reader';
import {
  InstallmentsOutOfRangeErrorBody,
  NotPublishedErrorBody,
} from '@/modules/billing/presentation/dto/billing-error.dto';
import { toHttpError } from '@/modules/billing/presentation/errors/billing-http-errors';
import {
  BillingQuoteQuery,
  BillingQuoteResponse,
  PricingResponse,
} from '@/modules/billing/presentation/dto/billing-quote.dto';

/** O preço público (Preço e cotação RN07): sem login, com cache curto. */
@ApiTags('billing')
@Controller('pricing')
@Public()
export class PricingController {
  constructor(private readonly reader: PrismaPublicPricingReader) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOkResponse({ type: PricingResponse })
  @ApiErrorResponses(...commonErrors({}))
  async pricing(): Promise<PricingResponse> {
    return PricingResponse.from({
      referralDiscountPercent: await this.reader.referralDiscountPercent(),
    });
  }
}

/** A cotação do servidor (Preço e cotação RN04): só o dono. */
@ApiTags('billing')
@Controller('weddings/:weddingId/billing')
export class BillingQuoteController {
  constructor(private readonly quote: QuoteBilling) {}

  @Get('quote')
  @ApiOkResponse({ type: BillingQuoteResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true }),
    InstallmentsOutOfRangeErrorBody,
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    NotDraftErrorBody,
    NotPublishedErrorBody,
    SiteSlugMissingErrorBody,
    EventDateMissingErrorBody,
    EndDateOutOfRangeErrorBody,
  )
  async getQuote(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Query() query: BillingQuoteQuery,
  ): Promise<BillingQuoteResponse> {
    try {
      const quote = await this.quote.execute({
        userId: session.userId,
        weddingId,
        kind: query.kind,
        endDate: query.endDate ?? null,
        method: query.method,
        installments: query.installments ?? 1,
        now: new Date(),
      });
      return BillingQuoteResponse.from({ quote });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
