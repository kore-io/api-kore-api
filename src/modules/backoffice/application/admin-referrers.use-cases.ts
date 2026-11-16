import { Inject, Injectable } from '@nestjs/common';
import { FIELD_CIPHER, type FieldCipher } from '@/shared/crypto/application/field-cipher.port';
import { WeddingActionForbiddenError } from '@/modules/access/domain/access.errors';
import type { ApplicationLogWriter } from '@/modules/logs/application/ports/application-log-writer.port';
import { maskTaxId } from '@/modules/referral/domain/payout-data';
import { ReferrerNotFoundError } from '@/modules/backoffice/domain/referrer-admin';
import type { StaffMember } from '@/modules/backoffice/domain/staff';
import { ADMIN_LOG_WRITER } from './admin-weddings.use-cases';
import {
  ADMIN_REFERRERS_READER,
  type AdminReferrerListQuery,
  type AdminReferrerPayout,
  type AdminReferrerProfile,
  type AdminReferrerRow,
  type AdminReferrersReader,
  type AdminReferrerStatementEntry,
} from '@/modules/backoffice/application/ports/admin-referrers.reader.port';
import type {
  AdminWeddingRow,
  Page,
} from '@/modules/backoffice/application/ports/admin-weddings.reader.port';

/** O mesmo contexto da cifra do Dados para receber (Repasse RN02). */
const TAX_ID_CONTEXT = { table: 'referrers', column: 'tax_id_encrypted' };

export type AdminReferrerTab = 'weddings' | 'commissions' | 'payouts';
export const ADMIN_REFERRER_TABS: readonly AdminReferrerTab[] = [
  'weddings',
  'commissions',
  'payouts',
];

/** O cabeçalho do detalhe: o CPF ou CNPJ só mascarado. */
export type AdminReferrerHeader = Omit<AdminReferrerProfile, 'taxIdEncrypted'> & {
  taxIdMasked: string | null;
  /** A cerimonialista segue sempre o padrão das Configurações (decisão 75). */
  rateIsDefault: boolean;
};

export type AdminReferrerDetail = { referrer: AdminReferrerHeader } & (
  | { tab: 'weddings'; weddings: Page<AdminWeddingRow> }
  | { tab: 'commissions'; statement: Page<AdminReferrerStatementEntry> }
  | { tab: 'payouts'; payouts: Page<AdminReferrerPayout> }
);

/**
 * A leitura das Cerimonialistas (Backoffice - cobrança RN08; Penpot 11): o
 * Admin e o suporte, que lê os saldos e o extrato, sem a aba Repasses, sem a
 * chave Pix e sem a tag "Repasse pedido" (RN01; decisão 69).
 */
@Injectable()
export class AdminReferrers {
  constructor(
    @Inject(ADMIN_REFERRERS_READER) private readonly reader: AdminReferrersReader,
    @Inject(ADMIN_LOG_WRITER) private readonly log: ApplicationLogWriter,
    @Inject(FIELD_CIPHER) private readonly cipher: FieldCipher,
  ) {}

  list({
    staff,
    query,
  }: {
    staff: StaffMember;
    query: AdminReferrerListQuery;
  }): Promise<Page<AdminReferrerRow>> {
    // O filtro do repasse pedido é do Admin, como a tag (decisão 69).
    if (query.hasPayout !== undefined && staff.role !== 'admin')
      throw new WeddingActionForbiddenError();
    return this.reader.list({ ...query, role: staff.role });
  }

  /**
   * O detalhe por aba, com o cabeçalho. A leitura do staff vai ao log, uma
   * linha por requisição (`admin.referrer_viewed` com a aba; B9-4).
   */
  async detail({
    staff,
    referrerId,
    tab,
    page,
    ip,
  }: {
    staff: StaffMember;
    referrerId: string;
    tab: AdminReferrerTab;
    page: number;
    ip: string | null;
  }): Promise<AdminReferrerDetail> {
    if (tab === 'payouts' && staff.role !== 'admin') throw new WeddingActionForbiddenError();
    const profile = await this.reader.profile({ referrerId, role: staff.role });
    if (!profile) throw new ReferrerNotFoundError();
    const { taxIdEncrypted, ...rest } = profile;
    const referrer: AdminReferrerHeader = {
      ...rest,
      // "20% · padrão das Configurações": no lançamento só há a cerimonialista,
      // que segue sempre o padrão (decisão 75); o vendedor com percentual
      // próprio fica fora (decisão 230, D17).
      rateIsDefault: true,
      taxIdMasked:
        profile.taxIdType && taxIdEncrypted
          ? maskTaxId({
              type: profile.taxIdType,
              value: await this.cipher.decrypt({
                ciphertext: taxIdEncrypted,
                context: TAX_ID_CONTEXT,
              }),
            })
          : null,
    };
    await this.log.record({
      entry: {
        action: 'admin.referrer_viewed',
        actorKind: 'admin',
        actorUserId: staff.userId,
        entityType: 'referrer',
        entityId: referrerId,
        data: { role: staff.role, tab, page },
        ...(ip ? { ip } : {}),
      },
    });
    switch (tab) {
      case 'weddings':
        return { referrer, tab, weddings: await this.reader.weddings({ referrerId, page }) };
      case 'commissions':
        return { referrer, tab, statement: await this.reader.statement({ referrerId, page }) };
      case 'payouts':
        return { referrer, tab, payouts: await this.reader.payouts({ referrerId, page }) };
    }
  }
}
