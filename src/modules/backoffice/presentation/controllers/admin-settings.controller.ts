import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UseGuards,
  type PipeTransform,
} from '@nestjs/common';
import { ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, commonErrors } from '@/shared/http/api-error-responses.decorator';
import { validationError } from '@/shared/http/validation-errors';
import type { AuthenticatedSession } from '@/modules/access/domain/sessions/authenticated-session';
import {
  ActionNotAllowedErrorBody,
  ReauthRequiredErrorBody,
} from '@/modules/access/presentation/dto/access-error.dto';
import { CurrentSession } from '@/modules/access/presentation/http/decorators/current-session.decorator';
import { OwnTransactions } from '@/modules/access/presentation/http/decorators/own-transactions.decorator';
import { AdminSettings } from '@/modules/backoffice/application/admin-settings.use-cases';
import {
  INTEGRATION_NAMES,
  type IntegrationName,
} from '@/modules/backoffice/domain/referral-settings';
import type { StaffMember } from '@/modules/backoffice/domain/staff';
import {
  AdminSettingsResponse,
  IntegrationTestResponse,
  ReferralSettingsBody,
  ReferralSettingsResponse,
  UpdateReferralSettingsResponse,
} from '@/modules/backoffice/presentation/dto/admin-settings.dto';
import {
  IntegrationNotConfiguredErrorBody,
  ReferralSettingsOutOfRangeErrorBody,
  StaffOnlyErrorBody,
} from '@/modules/backoffice/presentation/dto/backoffice-error.dto';
import { toHttpError } from '@/modules/backoffice/presentation/errors/backoffice-http-errors';
import {
  CurrentStaff,
  StaffGuard,
  StaffRoles,
} from '@/modules/backoffice/presentation/http/guards/staff.guard';

/** O `{name}` do Testar conexão: asaas, email ou maps; fora disso, 400. */
class IntegrationNamePipe implements PipeTransform<string, IntegrationName> {
  transform(value: string): IntegrationName {
    const name = INTEGRATION_NAMES.find((known) => known === value);
    if (!name)
      throw validationError({
        errors: [{ path: 'name', code: 'IS_IN', params: { values: INTEGRATION_NAMES } }],
      });
    return name;
  }
}

/**
 * As Configurações (Backoffice - cobrança RN10; Contrato de API; decisão
 * 267): só o Admin; o suporte recebe 403 ACTION_NOT_ALLOWED (decisão 69).
 */
@ApiTags('admin')
@Controller('admin')
@UseGuards(StaffGuard)
@StaffRoles('admin')
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettings) {}

  /** Valores vigentes, Indicação e Integrações, numa leitura só (Penpot 21). */
  @Get('settings')
  @OwnTransactions()
  @ApiOkResponse({ type: AdminSettingsResponse })
  @ApiErrorResponses(
    ...commonErrors({ session: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
  )
  async read(): Promise<AdminSettingsResponse> {
    return AdminSettingsResponse.from(await this.settings.read());
  }

  /**
   * Salvar a Indicação: sessão recente; 422 fora do formato (decisão 78); a
   * cerimonialista acompanha a Comissão padrão (decisão 75).
   */
  @Put('settings/referral')
  @OwnTransactions()
  @ApiOkResponse({ type: UpdateReferralSettingsResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    ReauthRequiredErrorBody,
    ReferralSettingsOutOfRangeErrorBody,
  )
  async updateReferral(
    @CurrentSession() session: AuthenticatedSession,
    @Body() body: ReferralSettingsBody,
  ): Promise<UpdateReferralSettingsResponse> {
    try {
      const { changed, referral } = await this.settings.updateReferral({
        session,
        values: {
          defaultRatePercent: body.defaultRatePercent,
          referralDiscountPercent: body.referralDiscountPercent,
          commissionHoldDays: body.commissionHoldDays,
          payoutMinCents: body.payoutMinCents,
        },
        now: new Date(),
      });
      return { changed, referral: ReferralSettingsResponse.from(referral) };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Testar conexão (B10-8): o ping da porta; o local responde "Conectado (local)". */
  @Post('integrations/:name/test')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'name', enum: INTEGRATION_NAMES })
  @ApiOkResponse({ type: IntegrationTestResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    IntegrationNotConfiguredErrorBody,
  )
  async testIntegration(
    @CurrentStaff() staff: StaffMember,
    @Param('name', new IntegrationNamePipe()) name: IntegrationName,
  ): Promise<IntegrationTestResponse> {
    try {
      return IntegrationTestResponse.from(
        await this.settings.testIntegration({ staff, name, now: new Date() }),
      );
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
