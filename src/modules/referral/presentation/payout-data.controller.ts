import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { TaxIdRateLimitGuard } from '../../../shared/rate-limit/user-rate-limit.guard';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import {
  ProfileNotOwnedErrorBody,
  ReauthRequiredErrorBody,
} from '../../access/presentation/access-error.dto';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import { PixKeyNotFoundError } from '../domain/referral.errors';
import { PayoutDataUseCases } from '../application/payout-data.use-cases';
import {
  ConfirmPixKeyBody,
  PixKeyChangePendingErrorBody,
  PixKeyConfirmedResponse,
  PixKeyLinkExpiredErrorBody,
  PixKeyNotFoundErrorBody,
  PixKeyRequestedResponse,
  PixKeysResponse,
  RequestPixKeyBody,
  SetTaxIdBody,
  TaxIdInUseErrorBody,
  TaxIdLockedErrorBody,
  TaxIdResponse,
} from './payout-data.dto';
import { toReferralHttpError } from './referral-http-errors';

const iso = (date: Date | null) => date?.toISOString() ?? null;

/** Dados para receber (Repasse e Dados para receber RN02 e RN03; decisão 244). */
@ApiTags('referral')
@Controller('me/referrer')
export class PayoutDataController {
  constructor(private readonly payoutData: PayoutDataUseCases) {}

  /** RN02: o CPF ou CNPJ, uma vez só; depois, só o Admin corrige. */
  @Put('tax-id')
  @UseGuards(TaxIdRateLimitGuard)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ProfileNotOwnedErrorBody,
    TaxIdLockedErrorBody,
    TaxIdInUseErrorBody,
  )
  async setTaxId(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: SetTaxIdBody,
  ): Promise<TaxIdResponse> {
    try {
      return await this.payoutData.setTaxId({
        userId: session.userId,
        type: body.taxIdType,
        taxId: body.taxId,
      });
    } catch (error) {
      throw toReferralHttpError(error);
    }
  }

  /** RN03 e RN09: a chave vigente, a troca em espera e o histórico, mascarados. */
  @Get('pix-keys')
  @ApiErrorResponses(...commonErrors({ session: true }), ProfileNotOwnedErrorBody)
  async listPixKeys(): Promise<PixKeysResponse> {
    try {
      const rows = await this.payoutData.listPixKeys({ now: new Date() });
      return {
        items: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          confirmExpiresAt: iso(row.confirmExpiresAt),
          confirmedAt: iso(row.confirmedAt),
          activeFrom: iso(row.activeFrom),
          replacedAt: iso(row.replacedAt),
          canceledAt: iso(row.canceledAt),
        })),
      };
    } catch (error) {
      throw toReferralHttpError(error);
    }
  }

  /** RN03: cadastrar a primeira chave ou pedir a troca; o link vai por e-mail. */
  @Post('pix-keys')
  @HttpCode(HttpStatus.CREATED)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ProfileNotOwnedErrorBody,
    ReauthRequiredErrorBody,
    PixKeyChangePendingErrorBody,
  )
  async requestPixKey(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: RequestPixKeyBody,
  ): Promise<PixKeyRequestedResponse> {
    try {
      const requested = await this.payoutData.requestPixKey({
        session,
        type: body.keyType,
        key: body.key,
        now: new Date(),
      });
      return { ...requested, confirmExpiresAt: requested.confirmExpiresAt.toISOString() };
    } catch (error) {
      throw toReferralHttpError(error);
    }
  }

  /** RN03: a confirmação pelo token do e-mail; a primeira vale na hora, a troca em 48 h. */
  @Post('pix-keys/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ProfileNotOwnedErrorBody,
    PixKeyNotFoundErrorBody,
    PixKeyLinkExpiredErrorBody,
  )
  async confirmPixKey(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: ConfirmPixKeyBody,
  ): Promise<PixKeyConfirmedResponse> {
    try {
      const confirmed = await this.payoutData.confirmPixKey({
        userId: session.userId,
        token: body.token,
        now: new Date(),
      });
      return { ...confirmed, activeFrom: confirmed.activeFrom.toISOString() };
    } catch (error) {
      throw toReferralHttpError(error);
    }
  }

  /** RN03: Cancelar troca enquanto ela não vale (ou o cadastro que esperava a confirmação). */
  @Delete('pix-keys/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiErrorResponses(
    ...commonErrors({ session: true, write: true }),
    ProfileNotOwnedErrorBody,
    ReauthRequiredErrorBody,
    PixKeyNotFoundErrorBody,
  )
  async cancelPixKey(
    @CurrentSession() session: AuthenticatedSession,
    @Param(
      'id',
      new ParseUUIDPipe({ exceptionFactory: () => toReferralHttpError(new PixKeyNotFoundError()) }),
    )
    id: string,
  ): Promise<void> {
    try {
      await this.payoutData.cancelPixKey({ session, id, now: new Date() });
    } catch (error) {
      throw toReferralHttpError(error);
    }
  }
}
