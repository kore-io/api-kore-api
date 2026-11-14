import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { AFTER_COMMIT, type AfterCommit } from '../../../shared/database/after-commit.port';
import {
  EMAIL_OUTBOX,
  type EmailOutbox,
} from '../../../shared/email/application/email-outbox.port';
import {
  FIELD_CIPHER,
  type FieldCipher,
} from '../../../shared/crypto/application/field-cipher.port';
import {
  PIX_KEY_HASHER,
  type PixKeyHasher,
} from '../../../shared/crypto/application/pix-key-hasher.port';
import {
  TAX_ID_HASHER,
  type TaxIdHasher,
} from '../../../shared/crypto/application/tax-id-hasher.port';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import { ProfileNotOwnedError } from '../../access/domain/access.errors';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import { requireNoRecentAccessChange } from '../../access/domain/recent-access-change';
import { requireRecentSession } from '../../access/domain/recent-session';
import { OpaqueSessionTokens } from '../../access/infrastructure/opaque-session-tokens';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import {
  maskPixKey,
  maskTaxId,
  normalizePixKey,
  normalizeTaxId,
  type PixKeyType,
  type TaxIdType,
} from '../domain/payout-data';
import {
  PixKeyChangePendingError,
  PixKeyLinkExpiredError,
  PixKeyNotFoundError,
  TaxIdInUseError,
  TaxIdLockedError,
} from '../domain/referral.errors';
import {
  pixKeyChangeCanceledEmail,
  pixKeyChangeConfirmedEmail,
  pixKeyConfirmEmail,
} from '../infrastructure/emails/pix-key.email';
import {
  PAYOUT_DATA_STORE,
  type PayoutDataStore,
  type PixKeyRow,
} from './ports/payout-data-store.port';

/** O link da chave vale 30 minutos (Repasse RN03). */
export const PIX_KEY_LINK_MS = 30 * 60_000;
/** A rota neutra do app (decisão 244(4)): ele confirma e leva à área de cada perfil. */
export const PAYOUT_DATA_PATH = '/dados-para-receber';

const TAX_ID_CONTEXT = { table: 'referrers', column: 'tax_id_encrypted' };
const PIX_KEY_CONTEXT = { table: 'referrer_pix_keys', column: 'key_encrypted' };

/** Uma entrada que o DTO já validou; aqui, de novo, por segurança. */
export class InvalidPayoutDataError extends Error {
  override name = 'InvalidPayoutDataError';
}

/**
 * Os Dados para receber (Repasse e Dados para receber RN02 e RN03; decisão
 * 244): o CPF ou CNPJ uma vez só, e a chave Pix confirmada pelo e-mail, com a
 * troca valendo 48 h depois.
 */
@Injectable()
export class PayoutDataUseCases {
  private readonly tokens = new OpaqueSessionTokens();
  private readonly appUrl: string;

  constructor(
    @Inject(PAYOUT_DATA_STORE) private readonly store: PayoutDataStore,
    @Inject(FIELD_CIPHER) private readonly cipher: FieldCipher,
    @Inject(TAX_ID_HASHER) private readonly taxIdHasher: TaxIdHasher,
    @Inject(PIX_KEY_HASHER) private readonly pixKeyHasher: PixKeyHasher,
    @Inject(EMAIL_OUTBOX) private readonly outbox: EmailOutbox,
    @Inject(AFTER_COMMIT) private readonly afterCommit: AfterCommit,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
    config: AppConfigService,
  ) {
    this.appUrl = config.get({ key: 'APP_URL' }).replace(/\/+$/, '');
  }

  /**
   * RN02: grava o CPF ou CNPJ (cifrado e o HMAC); na mesma transação, a
   * autoindicação roda de novo nas comissões dela (Comissões RN03).
   */
  async setTaxId({
    userId,
    type,
    taxId,
  }: {
    userId: string;
    type: TaxIdType;
    taxId: string;
  }): Promise<{ taxIdType: TaxIdType; taxIdMasked: string }> {
    const normalized = normalizeTaxId({ type, value: taxId });
    if (!normalized) throw new InvalidPayoutDataError();
    const digest = this.taxIdHasher.digest({ taxId: normalized });
    const encrypted = await this.cipher.encrypt({ plaintext: normalized, context: TAX_ID_CONTEXT });
    const result = await this.store.setTaxId({
      type,
      encrypted,
      hash: digest.hash,
      version: digest.version,
    });
    if (result === 'no_referrer') throw new ProfileNotOwnedError();
    if (result === 'locked') throw new TaxIdLockedError();
    if (result === 'in_use') throw new TaxIdInUseError();
    await this.log.record({
      entry: {
        action: 'referrer.tax_id_set',
        actorKind: 'user',
        actorUserId: userId,
        entityType: 'user',
        entityId: userId,
        data: { taxIdType: type },
      },
    });
    return { taxIdType: type, taxIdMasked: maskTaxId({ type, value: normalized }) };
  }

  /**
   * RN03: cadastrar a primeira chave ou pedir a troca, com sessão recente; a
   * chave espera a confirmação pelo link do e-mail (30 minutos).
   */
  async requestPixKey({
    session,
    type,
    key,
    now,
  }: {
    session: AuthenticatedSession;
    type: PixKeyType;
    key: string;
    now: Date;
  }): Promise<{ id: string; firstKey: boolean; emailMasked: string; confirmExpiresAt: Date }> {
    requireRecentSession({ session, now });
    // Decisão 253(2): 48 h depois de o staff trocar o e-mail de acesso, nem a
    // primeira chave nem a troca (o Admin não fura).
    requireNoRecentAccessChange({
      accessEmailChangedAt: await this.store.accessEmailChangedAt({ userId: session.userId }),
      now,
    });
    const normalized = normalizePixKey({ type, value: key });
    if (!normalized) throw new InvalidPayoutDataError();
    const { token, tokenHash } = this.tokens.generate();
    const id = uuidV7({ now: now.getTime() });
    const expiresAt = new Date(now.getTime() + PIX_KEY_LINK_MS);
    const keyMasked = maskPixKey({ type, value: normalized });
    const result = await this.store.requestPixKey({
      id,
      type,
      encrypted: await this.cipher.encrypt({ plaintext: normalized, context: PIX_KEY_CONTEXT }),
      hash: this.pixKeyHasher.digest({ type, key: normalized }),
      masked: keyMasked,
      tokenHash,
      expiresAt,
      now,
    });
    if (result.result === 'no_referrer') throw new ProfileNotOwnedError();
    if (result.result === 'change_pending') throw new PixKeyChangePendingError(result.activeFrom);
    const recipient = await this.store.recipient({ userId: session.userId });
    const url = `${this.appUrl}${PAYOUT_DATA_PATH}/confirmar?token=${encodeURIComponent(token)}`;
    this.afterCommit.schedule(() =>
      this.outbox.enqueue({
        message: pixKeyConfirmEmail({
          to: recipient.email,
          firstName: recipient.firstName,
          firstKey: result.firstKey,
          keyMasked,
          url,
        }),
        priority: 'default',
      }),
    );
    return {
      id,
      firstKey: result.firstKey,
      emailMasked: maskPixKey({ type: 'email', value: recipient.email.toLowerCase() }),
      confirmExpiresAt: expiresAt,
    };
  }

  /**
   * RN03: a confirmação pelo token do e-mail, na sessão dela. A primeira chave
   * vale na hora; a troca, 48 h depois (e o repasse pedido fica retido).
   */
  async confirmPixKey({
    userId,
    token,
    now,
  }: {
    userId: string;
    token: string;
    now: Date;
  }): Promise<{ id: string; status: 'active' | 'pending_activation'; activeFrom: Date }> {
    const result = await this.store.confirmPixKey({
      tokenHash: this.tokens.hash({ token }),
      now,
      alertId: uuidV7({ now: now.getTime() }),
    });
    if (!('keyId' in result)) {
      if (result.result === 'no_referrer') throw new ProfileNotOwnedError();
      if (result.result === 'not_found') throw new PixKeyNotFoundError();
      throw new PixKeyLinkExpiredError();
    }
    await this.log.record({
      entry: {
        action: 'pix_key.changed',
        actorKind: 'user',
        actorUserId: userId,
        entityType: 'referrer_pix_key',
        entityId: result.keyId,
        data: { status: result.result, activeFrom: result.activeFrom.toISOString() },
      },
    });
    if (result.result === 'pending_activation') {
      const recipient = await this.store.recipient({ userId });
      this.afterCommit.schedule(() =>
        this.outbox.enqueue({
          message: pixKeyChangeConfirmedEmail({
            to: recipient.email,
            firstName: recipient.firstName,
            activeFrom: result.activeFrom,
            url: `${this.appUrl}${PAYOUT_DATA_PATH}`,
          }),
          priority: 'default',
        }),
      );
    }
    return { id: result.keyId, status: result.result, activeFrom: result.activeFrom };
  }

  /** RN03: Cancelar troca enquanto ela não vale; o repasse retido pela troca segue. */
  async cancelPixKey({
    session,
    id,
    now,
  }: {
    session: AuthenticatedSession;
    id: string;
    now: Date;
  }): Promise<void> {
    requireRecentSession({ session, now });
    const result = await this.store.cancelPixKey({ id, now });
    if (!('wasChange' in result)) {
      if (result.result === 'no_referrer') throw new ProfileNotOwnedError();
      throw new PixKeyNotFoundError();
    }
    if (!result.wasChange) return;
    const recipient = await this.store.recipient({ userId: session.userId });
    this.afterCommit.schedule(() =>
      this.outbox.enqueue({
        message: pixKeyChangeCanceledEmail({
          to: recipient.email,
          firstName: recipient.firstName,
          url: `${this.appUrl}${PAYOUT_DATA_PATH}`,
        }),
        priority: 'default',
      }),
    );
  }

  /** RN03 e RN09: a chave vigente, a troca em espera e o histórico, mascarados. */
  async listPixKeys({ now }: { now: Date }): Promise<PixKeyRow[]> {
    if (!(await this.store.payoutData())) throw new ProfileNotOwnedError();
    return this.store.listPixKeys({ now });
  }

  /**
   * O que o `GET /v1/me/referrer` acrescenta (Repasse, Contrato): o CPF ou
   * CNPJ e a chave mascarados e se os dados estão completos para receber.
   */
  async summary(): Promise<{
    taxIdMasked: string | null;
    pixKeyMasked: string | null;
    payoutDataComplete: boolean;
  } | null> {
    const data = await this.store.payoutData();
    if (!data) return null;
    const taxIdMasked =
      data.taxIdType && data.taxIdEncrypted
        ? maskTaxId({
            type: data.taxIdType,
            value: await this.cipher.decrypt({
              ciphertext: data.taxIdEncrypted,
              context: TAX_ID_CONTEXT,
            }),
          })
        : null;
    return {
      taxIdMasked,
      pixKeyMasked: data.pixKeyMasked,
      payoutDataComplete: taxIdMasked !== null && data.pixKeyMasked !== null,
    };
  }
}
