import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { PayoutDataStore, PixKeyRow } from '../application/ports/payout-data-store.port';
import type { PixKeyType, TaxIdType } from '../domain/payout-data';

/** Na transação da requisição, com a RLS ligada (o kore_app só lê; grava pelas funções). */
@Injectable()
export class PrismaPayoutDataStore implements PayoutDataStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async setTaxId({
    type,
    encrypted,
    hash,
    version,
  }: {
    type: TaxIdType;
    encrypted: string;
    hash: string;
    version: number;
  }): Promise<'ok' | 'locked' | 'in_use' | 'no_referrer'> {
    const [row] = await this.tenant.client().$queryRaw<{ result: string }[]>`
      SELECT set_referrer_tax_id(${type}::tax_id_type, ${encrypted}, ${hash},
                                 ${version}::smallint) AS result`;
    return row.result as 'ok' | 'locked' | 'in_use' | 'no_referrer';
  }

  async requestPixKey(input: {
    id: string;
    type: PixKeyType;
    encrypted: string;
    hash: string;
    masked: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): ReturnType<PayoutDataStore['requestPixKey']> {
    const [row] = await this.tenant.client().$queryRaw<
      { result: string; first_key: boolean; active_from: Date | null }[]
    >`SELECT * FROM request_referrer_pix_key(${input.id}::uuid, ${input.type}::pix_key_type,
        ${input.encrypted}, ${input.hash}, ${input.masked}, ${input.tokenHash},
        ${input.expiresAt}::timestamptz, ${input.now}::timestamptz)`;
    if (row.result === 'ok') return { result: 'ok', firstKey: row.first_key };
    if (row.result === 'change_pending')
      return { result: 'change_pending', activeFrom: row.active_from! };
    return { result: 'no_referrer' };
  }

  async confirmPixKey({
    tokenHash,
    now,
    alertId,
  }: {
    tokenHash: string;
    now: Date;
    alertId: string;
  }): ReturnType<PayoutDataStore['confirmPixKey']> {
    const [row] = await this.tenant.client().$queryRaw<
      {
        result: string;
        key_id: string | null;
        active_from: Date | null;
        key_masked: string | null;
      }[]
    >`SELECT * FROM confirm_referrer_pix_key(${tokenHash}, ${now}::timestamptz, ${alertId}::uuid)`;
    if (row.result === 'active' || row.result === 'pending_activation')
      return {
        result: row.result,
        keyId: row.key_id!,
        activeFrom: row.active_from!,
        keyMasked: row.key_masked!,
      };
    return { result: row.result as 'expired' | 'not_found' | 'no_referrer' };
  }

  async cancelPixKey({
    id,
    now,
  }: {
    id: string;
    now: Date;
  }): ReturnType<PayoutDataStore['cancelPixKey']> {
    const [row] = await this.tenant.client().$queryRaw<
      { result: string; was_change: boolean; key_masked: string | null }[]
    >`SELECT * FROM cancel_referrer_pix_key(${id}::uuid, ${now}::timestamptz)`;
    if (row.result === 'ok')
      return { result: 'ok', wasChange: row.was_change, keyMasked: row.key_masked! };
    return { result: row.result as 'not_found' | 'no_referrer' };
  }

  async listPixKeys({ now }: { now: Date }): Promise<PixKeyRow[]> {
    const client = this.tenant.client();
    await client.$queryRaw`SELECT activate_my_due_pix_keys(${now}::timestamptz)`;
    return client.referrerPixKey.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        keyType: true,
        keyMasked: true,
        status: true,
        createdAt: true,
        confirmExpiresAt: true,
        confirmedAt: true,
        activeFrom: true,
        replacedAt: true,
        canceledAt: true,
      },
    });
  }

  async payoutData(): ReturnType<PayoutDataStore['payoutData']> {
    const [row] = await this.tenant.client().$queryRaw<
      {
        referrer_id: string;
        tax_id_type: TaxIdType | null;
        tax_id_encrypted: string | null;
        pix_key_masked: string | null;
      }[]
    >`SELECT * FROM my_referrer_payout_data()`;
    return row
      ? {
          referrerId: row.referrer_id,
          taxIdType: row.tax_id_type,
          taxIdEncrypted: row.tax_id_encrypted,
          pixKeyMasked: row.pix_key_masked,
        }
      : null;
  }

  async recipient({
    userId,
  }: {
    userId: string;
  }): Promise<{ email: string; firstName: string | null }> {
    const user = await this.tenant.client().user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, name: true },
    });
    return { email: user.email, firstName: user.name?.trim().split(/\s+/)[0] || null };
  }
}
