import type { FieldError } from '@/shared/http/validation-errors';

/** Os quatro campos da Indicação (Backoffice - cobrança RN10; `ReferralSettings`). */
export interface ReferralSettingsValues {
  /** Comissão padrão: o percentual de toda cerimonialista (decisão 75). */
  defaultRatePercent: number;
  /** Desconto de indicação, sobre o preço de tabela. */
  referralDiscountPercent: number;
  /** Prazo de liberação da comissão, em dias. */
  commissionHoldDays: number;
  /** Repasse mínimo, em centavos. */
  payoutMinCents: number;
}

export const REFERRAL_SETTINGS_FIELDS = [
  'defaultRatePercent',
  'referralDiscountPercent',
  'commissionHoldDays',
  'payoutMinCents',
] as const satisfies readonly (keyof ReferralSettingsValues)[];

/**
 * A validação de formato (decisão 78, sem teto de negócio): percentual de 0 a
 * 100, prazo de 0 a 90 dias, mínimo a partir de R$ 1. Os inteiros já vêm do
 * DTO; aqui ficam as faixas, que dão 422 (Contrato de API).
 */
/** O teto técnico do repasse mínimo: a coluna é int4 (sem teto de negócio, decisão 78). */
export const PAYOUT_MIN_CENTS_MAX = 2_147_483_647;

const RANGES: Record<keyof ReferralSettingsValues, { min: number; max: number }> = {
  defaultRatePercent: { min: 0, max: 100 },
  referralDiscountPercent: { min: 0, max: 100 },
  commissionHoldDays: { min: 0, max: 90 },
  payoutMinCents: { min: 100, max: PAYOUT_MIN_CENTS_MAX },
};

export function referralSettingsErrors(values: ReferralSettingsValues): FieldError[] {
  const errors: FieldError[] = [];
  for (const field of REFERRAL_SETTINGS_FIELDS) {
    const { min, max } = RANGES[field];
    const value = values[field];
    if (value < min) errors.push({ path: field, code: 'MIN', params: { min } });
    else if (value > max) errors.push({ path: field, code: 'MAX', params: { max } });
  }
  return errors;
}

/** O que mudou, com o antes e o depois (o log `settings.referral_updated`). */
export function referralSettingsChanges({
  before,
  after,
}: {
  before: ReferralSettingsValues;
  after: ReferralSettingsValues;
}): Partial<Record<keyof ReferralSettingsValues, { from: number; to: number }>> {
  const changes: Partial<Record<keyof ReferralSettingsValues, { from: number; to: number }>> = {};
  for (const field of REFERRAL_SETTINGS_FIELDS)
    if (before[field] !== after[field]) changes[field] = { from: before[field], to: after[field] };
  return changes;
}

/** As integrações da tela (RN10; decisão 267(1)). */
export const INTEGRATION_NAMES = ['asaas', 'email', 'maps'] as const;
export type IntegrationName = (typeof INTEGRATION_NAMES)[number];

/**
 * O serviço de mapas ainda não existe na API (o mapa estático é card do
 * Backlog, decisão 205): ele aparece como `not_configured` e o teste dá 409
 * (decisão 267(1)).
 */
export const CONFIGURED_INTEGRATIONS: readonly IntegrationName[] = ['asaas', 'email'];

/** O tempo limite do Testar conexão: sem resposta até lá, Falhou. */
export const INTEGRATION_TEST_TIMEOUT_MS = 10_000;

/** O log de cada teste: o GET /settings lê o último daqui, sem tabela (decisão 267(2)). */
export const INTEGRATION_TESTED_ACTION = 'integration.tested';
export const REFERRAL_SETTINGS_UPDATED_ACTION = 'settings.referral_updated';
