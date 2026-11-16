import { ApiProperty } from '@nestjs/swagger';
import { IsInt } from 'class-validator';
import type {
  AdminSettingsView,
  CurrentValues,
  IntegrationStatus,
} from '@/modules/backoffice/application/admin-settings.use-cases';
import type {
  IntegrationTestResult,
  StoredReferralSettings,
} from '@/modules/backoffice/application/ports/admin-settings.store.port';
import {
  INTEGRATION_NAMES,
  type IntegrationName,
} from '@/modules/backoffice/domain/referral-settings';

/**
 * Os quatro campos da Indicação. Aqui só o tipo (inteiro; 400); as faixas da
 * decisão 78 dão 422 (Contrato de API).
 */
export class ReferralSettingsBody {
  /** Comissão padrão, de 0 a 100. */
  @ApiProperty({ example: 22 }) @IsInt() defaultRatePercent: number;
  /** Desconto de indicação, de 0 a 100. */
  @ApiProperty({ example: 10 }) @IsInt() referralDiscountPercent: number;
  /** Prazo de liberação, de 0 a 90 dias. */
  @ApiProperty({ example: 30 }) @IsInt() commissionHoldDays: number;
  /** Repasse mínimo em centavos, de 100 (R$ 1) até 2.147.483.647 (o teto técnico da coluna). */
  @ApiProperty({ example: 5000 }) @IsInt() payoutMinCents: number;
}

class UpdatedByResponse {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
}

export class ReferralSettingsResponse extends ReferralSettingsBody {
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: UpdatedByResponse, nullable: true }) updatedBy: UpdatedByResponse | null;

  static from(settings: StoredReferralSettings): ReferralSettingsResponse {
    return { ...settings, updatedAt: settings.updatedAt.toISOString() };
  }
}

/** Valores vigentes, só leitura: vêm da versão de preço do código (RN10). */
class CurrentValuesResponse {
  @ApiProperty({ example: '2026-11' }) priceVersion: string;
  @ApiProperty({ example: 14900 }) activationCents: number;
  @ApiProperty({ example: 2900 }) monthlyCents: number;
  /** Preço máximo da publicação. */
  @ApiProperty({ example: 44900 }) capCents: number;
  @ApiProperty({ example: 3 }) pixDiscountPercent: number;
  /** Parcelamento sem juros até. */
  @ApiProperty({ example: 6 }) interestFreeUpTo: number;
  @ApiProperty({ example: 12 }) maxInstallments: number;
  /** Juros de 7x a 12x: 3,99% (399) + R$ 0,49 (49) sobre o valor. */
  @ApiProperty({ example: 399 }) interestBasisPoints: number;
  @ApiProperty({ example: 49 }) interestFixedCents: number;
  @ApiProperty({ example: 500 }) minInstallmentCents: number;
  /** Data de saída do ar até N meses depois do casamento. */
  @ApiProperty({ example: 12 }) endDateMaxMonthsAfterEvent: number;
  /** Retenção: "6 meses depois de expirar". */
  @ApiProperty({ example: 6 }) retentionMonthsAfterExpired: number;
  /** Pedido de repasse a cada N dias, contados do último. */
  @ApiProperty({ example: 30 }) payoutRequestIntervalDays: number;

  static from(values: CurrentValues): CurrentValuesResponse {
    return { ...values };
  }
}

export class IntegrationTestResponse {
  @ApiProperty({ enum: ['connected', 'failed'] }) status: 'connected' | 'failed';
  @ApiProperty({ format: 'date-time' }) testedAt: string;
  /** O adaptador local: "Conectado (local)". */
  @ApiProperty() local: boolean;

  static from(result: IntegrationTestResult): IntegrationTestResponse {
    return { ...result, testedAt: result.testedAt.toISOString() };
  }
}

class IntegrationStatusResponse {
  @ApiProperty({ enum: INTEGRATION_NAMES }) name: IntegrationName;
  /** `not_configured`: ainda não existe na API (o mapa; decisão 267(1)). */
  @ApiProperty({ enum: ['connected', 'failed', 'not_tested', 'not_configured'] })
  status: IntegrationStatus['status'];
  /** O último Testar conexão; nulo sem teste. */
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) testedAt: string | null;
  @ApiProperty() local: boolean;
}

export class AdminSettingsResponse {
  @ApiProperty({ type: CurrentValuesResponse }) current: CurrentValuesResponse;
  @ApiProperty({ type: ReferralSettingsResponse }) referral: ReferralSettingsResponse;
  @ApiProperty({ type: [IntegrationStatusResponse] }) integrations: IntegrationStatusResponse[];

  static from(view: AdminSettingsView): AdminSettingsResponse {
    return {
      current: CurrentValuesResponse.from(view.current),
      referral: ReferralSettingsResponse.from(view.referral),
      integrations: view.integrations.map((integration) => ({
        name: integration.name,
        status: integration.status,
        testedAt: 'testedAt' in integration ? integration.testedAt.toISOString() : null,
        local: integration.local,
      })),
    };
  }
}

export class UpdateReferralSettingsResponse {
  /** Falso quando nada mudou: nada foi gravado. */
  @ApiProperty() changed: boolean;
  @ApiProperty({ type: ReferralSettingsResponse }) referral: ReferralSettingsResponse;
}
