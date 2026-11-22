import type {
  IntegrationName,
  ReferralSettingsValues,
} from '@/modules/backoffice/domain/referral-settings';

export interface StoredReferralSettings extends ReferralSettingsValues {
  updatedAt: Date;
  updatedBy: { userId: string; name: string | null } | null;
}

/** O último Testar conexão de uma integração, lido do log (decisão 267(2)). */
export interface IntegrationTestResult {
  status: 'connected' | 'failed';
  testedAt: Date;
  local: boolean;
}

/** As Configurações pela conexão do backoffice (decisão 180(5)), na transação corrente. */
export interface AdminSettingsStore {
  readReferralSettings(): Promise<StoredReferralSettings>;
  /** Trava a linha única do ReferralSettings antes de trocar. */
  lockReferralSettings(): Promise<ReferralSettingsValues>;
  /**
   * Grava os quatro campos e, na mesma transação, leva o ratePercent de toda
   * cerimonialista ao padrão (decisão 75). Devolve quantas mudaram.
   */
  updateReferralSettings(input: {
    values: ReferralSettingsValues;
    adminUserId: string;
    now: Date;
  }): Promise<{ plannersUpdated: number }>;
  logReferralSettingsUpdated(input: {
    adminUserId: string;
    data: Record<string, unknown>;
    now: Date;
  }): Promise<void>;
  lastIntegrationTests(): Promise<Partial<Record<IntegrationName, IntegrationTestResult>>>;
}

export const ADMIN_SETTINGS_STORE = Symbol('AdminSettingsStore');
