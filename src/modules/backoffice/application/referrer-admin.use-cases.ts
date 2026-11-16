import { Inject, Injectable } from '@nestjs/common';
import { FIELD_CIPHER, type FieldCipher } from '@/shared/crypto/application/field-cipher.port';
import { TAX_ID_HASHER, type TaxIdHasher } from '@/shared/crypto/application/tax-id-hasher.port';
import { BackofficeTransaction } from '@/shared/database/backoffice-transaction';
import type { AuthenticatedSession } from '@/modules/access/domain/authenticated-session';
import { requireRecentSession } from '@/modules/access/domain/recent-session';
import { maskTaxId, normalizeTaxId } from '@/modules/referral/domain/payout-data';
import {
  CommissionNotBlockableError,
  CommissionNotFoundError,
  InvalidReferrerTaxIdError,
  isCommissionBlockable,
  opensManualAdjustmentAlert,
  ReferrerAlreadyBlockedError,
  ReferrerNotBlockedError,
  ReferrerNotFoundError,
  ReferrerTaxIdInUseError,
  unblockedStatus,
} from '@/modules/backoffice/domain/referrer-admin';
import { REFERRER_ADMIN_STORE, type ReferrerAdminStore } from './ports/referrer-admin.store.port';

const TAX_ID_CONTEXT = { table: 'referrers', column: 'tax_id_encrypted' };

/**
 * As ações do Admin na cerimonialista (Backoffice - cobrança RN08 e Contrato
 * de API): bloquear e desbloquear a cerimonialista e a comissão, ajustar a
 * comissão e corrigir o CPF ou CNPJ, com motivo e log. A sessão recente vale
 * no desbloqueio da comissão, no ajuste positivo e na correção do documento.
 */
@Injectable()
export class ReferrerAdminActions {
  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(REFERRER_ADMIN_STORE) private readonly store: ReferrerAdminStore,
    @Inject(FIELD_CIPHER) private readonly cipher: FieldCipher,
    @Inject(TAX_ID_HASHER) private readonly taxIdHasher: TaxIdHasher,
  ) {}

  /**
   * Bloquear (decisão 68; 230 D15): o User sem login e as sessões caídas, o
   * Referrer bloqueado (o link responde 404, casamentos novos não recebem a
   * atribuição, os pagamentos geram comissão bloqueada) e o repasse pedido
   * retido. Os vínculos de colaboradora ficam.
   */
  blockReferrer({
    referrerId,
    adminUserId,
    reason,
    now,
  }: {
    referrerId: string;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<{ heldPayoutIds: string[] }> {
    return this.transaction.run(async () => {
      const referrer = await this.store.lockReferrer({ referrerId });
      if (!referrer) throw new ReferrerNotFoundError();
      if (referrer.status === 'blocked') throw new ReferrerAlreadyBlockedError();
      return this.store.blockReferrer({ referrer, adminUserId, reason, now });
    });
  }

  /**
   * Desbloquear: o acesso e o link voltam. As comissões bloqueadas continuam
   * bloqueadas (o Admin as libera uma a uma), e o repasse retido segue retido
   * até o Liberar ou o Recusar da fila (RN09).
   */
  unblockReferrer({
    referrerId,
    adminUserId,
    reason,
    now,
  }: {
    referrerId: string;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<void> {
    return this.transaction.run(async () => {
      const referrer = await this.store.lockReferrer({ referrerId });
      if (!referrer) throw new ReferrerNotFoundError();
      if (referrer.status !== 'blocked') throw new ReferrerNotBlockedError();
      await this.store.unblockReferrer({ referrer, adminUserId, reason, now });
    });
  }

  /** B10-4: pendente ou disponível; dentro de um repasse pedido, ele fica retido. */
  blockCommission({
    commissionId,
    adminUserId,
    reason,
    now,
  }: {
    commissionId: string;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<{ heldPayoutId: string | null }> {
    return this.transaction.run(async () => {
      const commission = await this.store.lockCommission({ commissionId });
      if (!commission) throw new CommissionNotFoundError();
      if (
        !isCommissionBlockable({ status: commission.status, payoutStatus: commission.payoutStatus })
      )
        throw new CommissionNotBlockableError(commission.status);
      return this.store.blockCommission({ commission, adminUserId, reason, now });
    });
  }

  /** Desbloquear a comissão: sessão recente; ela volta a seguir o prazo de liberação. */
  unblockCommission({
    session,
    commissionId,
    reason,
    now,
  }: {
    session: AuthenticatedSession;
    commissionId: string;
    reason: string;
    now: Date;
  }): Promise<{ status: 'pending' | 'available' }> {
    requireRecentSession({ session, now });
    return this.transaction.run(async () => {
      const commission = await this.store.lockCommission({ commissionId });
      if (!commission) throw new CommissionNotFoundError();
      if (commission.status !== 'blocked') throw new CommissionNotBlockableError(commission.status);
      const status = unblockedStatus({ availableAt: commission.availableAt, now });
      await this.store.unblockCommission({
        commission,
        status,
        adminUserId: session.userId,
        reason,
        now,
      });
      return { status };
    });
  }

  /**
   * Ajustar a comissão (Somar ou Descontar): o CommissionAdjustment `manual`,
   * que entra no extrato e no próximo repasse; o positivo pede sessão recente
   * e, acima de R$ 500,00, abre o Alert `manual_adjustment` (B10-7).
   */
  adjust({
    session,
    referrerId,
    amountCents,
    reason,
    now,
  }: {
    session: AuthenticatedSession;
    referrerId: string;
    amountCents: number;
    reason: string;
    now: Date;
  }): Promise<{ adjustmentId: string }> {
    if (amountCents > 0) requireRecentSession({ session, now });
    return this.transaction.run(async () => {
      const referrer = await this.store.lockReferrer({ referrerId });
      if (!referrer) throw new ReferrerNotFoundError();
      return this.store.addAdjustment({
        referrerId,
        amountCents,
        reason,
        adminUserId: session.userId,
        openAlert: opensManualAdjustmentAlert({ amountCents }),
        now,
      });
    });
  }

  /**
   * Corrigir CPF ou CNPJ (decisão 74; B6-7): sessão recente; o documento novo,
   * cifrado e com o HMAC, único entre os indicadores (409 TAX_ID_IN_USE), e a
   * autoindicação de novo na mesma transação. O log não leva o documento.
   */
  async correctTaxId({
    session,
    referrerId,
    type,
    taxId,
    reason,
    now,
  }: {
    session: AuthenticatedSession;
    referrerId: string;
    type: 'cpf' | 'cnpj';
    taxId: string;
    reason: string;
    now: Date;
  }): Promise<{ taxIdType: 'cpf' | 'cnpj'; taxIdMasked: string }> {
    requireRecentSession({ session, now });
    const normalized = normalizeTaxId({ type, value: taxId });
    if (!normalized) throw new InvalidReferrerTaxIdError();
    const digest = this.taxIdHasher.digest({ taxId: normalized });
    const encrypted = await this.cipher.encrypt({ plaintext: normalized, context: TAX_ID_CONTEXT });
    const result = await this.transaction.run(async () => {
      const referrer = await this.store.lockReferrer({ referrerId });
      if (!referrer) throw new ReferrerNotFoundError();
      return this.store.correctTaxId({
        referrerId,
        type,
        encrypted,
        hash: digest.hash,
        version: digest.version,
        adminUserId: session.userId,
        reason,
        now,
      });
    });
    if (result === 'in_use') throw new ReferrerTaxIdInUseError();
    return { taxIdType: type, taxIdMasked: maskTaxId({ type, value: normalized }) };
  }
}
