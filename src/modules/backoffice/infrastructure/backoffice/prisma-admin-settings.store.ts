import { Injectable } from '@nestjs/common';
import type { Prisma } from '@/generated/prisma/client';
import { REFERRAL_SETTINGS_LOCK_KEY } from '@/shared/database/advisory-lock-keys';
import { BackofficeTransaction } from '@/shared/database/backoffice-transaction';
import type {
  AdminSettingsStore,
  IntegrationTestResult,
  StoredReferralSettings,
} from '@/modules/backoffice/application/ports/admin-settings.store.port';
import {
  INTEGRATION_NAMES,
  INTEGRATION_TESTED_ACTION,
  REFERRAL_SETTINGS_UPDATED_ACTION,
  type IntegrationName,
  type ReferralSettingsValues,
} from '@/modules/backoffice/domain/referral-settings';

const VALUES_SELECT = {
  id: true,
  defaultRatePercent: true,
  referralDiscountPercent: true,
  commissionHoldDays: true,
  payoutMinCents: true,
} as const;

/** Pelo kore_backoffice, na transação corrente (decisão 180(5)). */
@Injectable()
export class PrismaAdminSettingsStore implements AdminSettingsStore {
  constructor(private readonly transaction: BackofficeTransaction) {}

  private db(): Prisma.TransactionClient {
    return this.transaction.client();
  }

  async readReferralSettings(): Promise<StoredReferralSettings> {
    const settings = await this.db().referralSettings.findFirstOrThrow({
      select: {
        ...VALUES_SELECT,
        updatedAt: true,
        updatedBy: { select: { id: true, name: true } },
      },
    });
    return {
      defaultRatePercent: settings.defaultRatePercent,
      referralDiscountPercent: settings.referralDiscountPercent,
      commissionHoldDays: settings.commissionHoldDays,
      payoutMinCents: settings.payoutMinCents,
      updatedAt: settings.updatedAt,
      updatedBy: settings.updatedBy
        ? { userId: settings.updatedBy.id, name: settings.updatedBy.name }
        : null,
    };
  }

  async lockReferralSettings(): Promise<ReferralSettingsValues> {
    // Primeiro o lock exclusivo da troca: espera o cadastro de cerimonialista
    // em curso e segura os próximos até o commit (decisão 269).
    await this.db()
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${REFERRAL_SETTINGS_LOCK_KEY}, 0))`;
    // A linha é única (uq_referral_settings_single_row).
    const [row] = await this.db().$queryRaw<ReferralSettingsValues[]>`
      SELECT default_rate_percent AS "defaultRatePercent",
             referral_discount_percent AS "referralDiscountPercent",
             commission_hold_days AS "commissionHoldDays",
             payout_min_cents AS "payoutMinCents"
      FROM referral_settings
      FOR UPDATE`;
    if (!row) throw new Error('referral_settings sem a linha única.');
    return row;
  }

  async updateReferralSettings({
    values,
    adminUserId,
    now,
  }: {
    values: ReferralSettingsValues;
    adminUserId: string;
    now: Date;
  }): Promise<{ plannersUpdated: number }> {
    await this.db().referralSettings.updateMany({
      data: { ...values, updatedAt: now, updatedByUserId: adminUserId },
    });
    // A cerimonialista segue sempre o padrão (decisão 75): as comissões já
    // criadas não mudam, porque guardam o percentual da data do pagamento.
    const { count } = await this.db().referrer.updateMany({
      where: { kind: 'planner', ratePercent: { not: values.defaultRatePercent } },
      data: { ratePercent: values.defaultRatePercent },
    });
    return { plannersUpdated: count };
  }

  async logReferralSettingsUpdated({
    adminUserId,
    data,
    now,
  }: {
    adminUserId: string;
    data: Record<string, unknown>;
    now: Date;
  }): Promise<void> {
    await this.db().applicationLog.create({
      data: {
        createdAt: now,
        action: REFERRAL_SETTINGS_UPDATED_ACTION,
        actorKind: 'admin',
        actorUserId: adminUserId,
        entityType: 'referral_settings',
        data: data as Prisma.InputJsonValue,
      },
    });
  }

  async lastIntegrationTests(): Promise<Partial<Record<IntegrationName, IntegrationTestResult>>> {
    const rows = await this.db().$queryRaw<
      { name: string; status: string; local: boolean | null; created_at: Date }[]
    >`
      SELECT DISTINCT ON (data->>'name')
             data->>'name' AS name, data->>'status' AS status,
             (data->>'local')::boolean AS local, created_at
      FROM application_logs
      WHERE action = ${INTEGRATION_TESTED_ACTION}
      ORDER BY data->>'name', created_at DESC`;
    const results: Partial<Record<IntegrationName, IntegrationTestResult>> = {};
    for (const row of rows) {
      const name = INTEGRATION_NAMES.find((known) => known === row.name);
      if (!name || (row.status !== 'connected' && row.status !== 'failed')) continue;
      results[name] = { status: row.status, testedAt: row.created_at, local: row.local ?? false };
    }
    return results;
  }
}
