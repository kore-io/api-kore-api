import { Inject, Injectable } from '@nestjs/common';
import { BackofficeTransaction } from '@/shared/database/backoffice-transaction';
import type { AuthenticatedSession } from '@/modules/access/domain/sessions/authenticated-session';
import { requireRecentSession } from '@/modules/access/domain/sessions/recent-session';
import { CURRENT_PRICE_TABLE, type PriceTable } from '@/modules/billing/domain/payments/pricing';
import type { ApplicationLogWriter } from '@/modules/logs/application/ports/application-log-writer.port';
import {
  IntegrationNotConfiguredError,
  InvalidReferralSettingsError,
} from '@/modules/backoffice/domain/backoffice.errors';
import {
  INTEGRATION_NAMES,
  INTEGRATION_TEST_TIMEOUT_MS,
  INTEGRATION_TESTED_ACTION,
  referralSettingsChanges,
  referralSettingsErrors,
  type IntegrationName,
  type ReferralSettingsValues,
} from '@/modules/backoffice/domain/referral-settings';
import type { StaffMember } from '@/modules/backoffice/domain/staff';
import { ADMIN_LOG_WRITER } from './admin-weddings.use-cases';
import {
  ADMIN_SETTINGS_STORE,
  type AdminSettingsStore,
  type IntegrationTestResult,
  type StoredReferralSettings,
} from './ports/admin-settings.store.port';
import { INTEGRATION_PROBES, type IntegrationProbes } from './ports/integration-probes.port';

/**
 * Os Valores vigentes (RN10): a versão de preço do código e as regras fixas
 * que a tela mostra como texto. A retenção (6 meses depois de expirar) e o
 * intervalo do pedido de repasse (30 dias do último) vivem no SQL
 * (wedding-lifecycle e request_referrer_payout); aqui, só para a leitura.
 */
export interface CurrentValues extends PriceTable {
  retentionMonthsAfterExpired: number;
  payoutRequestIntervalDays: number;
}

const CURRENT_VALUES: CurrentValues = {
  ...CURRENT_PRICE_TABLE,
  retentionMonthsAfterExpired: 6,
  payoutRequestIntervalDays: 30,
};

export type IntegrationStatus =
  | ({ name: IntegrationName; status: 'connected' | 'failed' } & Omit<
      IntegrationTestResult,
      'status'
    >)
  | { name: IntegrationName; status: 'not_tested' | 'not_configured'; local: boolean };

export interface AdminSettingsView {
  current: CurrentValues;
  referral: StoredReferralSettings;
  integrations: IntegrationStatus[];
}

/**
 * As Configurações do Backoffice (Backoffice - cobrança RN10; Contrato de
 * API; decisão 267): só o Admin (o guard recusa o suporte com 403).
 */
@Injectable()
export class AdminSettings {
  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(ADMIN_SETTINGS_STORE) private readonly store: AdminSettingsStore,
    @Inject(INTEGRATION_PROBES) private readonly probes: IntegrationProbes,
    @Inject(ADMIN_LOG_WRITER) private readonly log: ApplicationLogWriter,
  ) {}

  read(): Promise<AdminSettingsView> {
    return this.transaction.run(async () => {
      const [referral, tests] = await Promise.all([
        this.store.readReferralSettings(),
        this.store.lastIntegrationTests(),
      ]);
      return {
        current: CURRENT_VALUES,
        referral,
        integrations: INTEGRATION_NAMES.map((name): IntegrationStatus => {
          const probe = this.probes[name];
          if (!probe) return { name, status: 'not_configured', local: false };
          const last = tests[name];
          return last ? { name, ...last } : { name, status: 'not_tested', local: probe.local };
        }),
      };
    });
  }

  /**
   * Salvar a Indicação (RN10): sessão recente (B10-1), o formato da decisão
   * 78 (422), e na mesma transação o ratePercent das cerimonialistas
   * (decisão 75) e o log `settings.referral_updated` com o antes e o depois.
   * Sem mudança, nada grava. Os pagamentos já feitos não mudam.
   */
  async updateReferral({
    session,
    values,
    now,
  }: {
    session: AuthenticatedSession;
    values: ReferralSettingsValues;
    now: Date;
  }): Promise<{ changed: boolean; referral: StoredReferralSettings }> {
    requireRecentSession({ session, now });
    const errors = referralSettingsErrors(values);
    if (errors.length > 0) throw new InvalidReferralSettingsError(errors);
    return this.transaction.run(async () => {
      const before = await this.store.lockReferralSettings();
      const changes = referralSettingsChanges({ before, after: values });
      if (Object.keys(changes).length === 0)
        return { changed: false, referral: await this.store.readReferralSettings() };
      const { plannersUpdated } = await this.store.updateReferralSettings({
        values,
        adminUserId: session.userId,
        now,
      });
      await this.store.logReferralSettingsUpdated({
        adminUserId: session.userId,
        data: { before, after: values, changes, plannersUpdated },
        now,
      });
      return { changed: true, referral: await this.store.readReferralSettings() };
    });
  }

  /**
   * Testar conexão (RN10; decisão 267): o ping da porta com tempo limite; o
   * resultado vai ao log `integration.tested`, de onde o GET lê o último.
   */
  async testIntegration({
    staff,
    name,
    now,
  }: {
    staff: StaffMember;
    name: IntegrationName;
    now: Date;
  }): Promise<IntegrationTestResult> {
    const probe = this.probes[name];
    if (!probe) throw new IntegrationNotConfiguredError();
    let failure: string | null = null;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        probe.ping(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Integration test timed out.')),
            INTEGRATION_TEST_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      // Só o tipo do erro: a mensagem do serviço pode trazer endereço ou credencial.
      failure = error instanceof Error ? error.name : 'Error';
    } finally {
      clearTimeout(timer);
    }
    const result: IntegrationTestResult = {
      status: failure ? 'failed' : 'connected',
      testedAt: now,
      local: probe.local,
    };
    await this.log.record({
      entry: {
        action: INTEGRATION_TESTED_ACTION,
        actorKind: 'admin',
        actorUserId: staff.userId,
        entityType: 'integration',
        data: { name, status: result.status, local: result.local, ...(failure ? { failure } : {}) },
      },
    });
    return result;
  }
}
