import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { BackofficeTransaction } from '../../../shared/database/backoffice-transaction';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
  type PresignedPut,
} from '../../../shared/storage/application/object-storage.port';
import {
  PaymentNotFoundError,
  PaymentNotMismatchedError,
  RefundNotFailedError,
  RefundNotRequestedError,
  RefundReceiptMissingError,
  RefundReceiptNotFoundError,
} from '../domain/billing.errors';
import {
  isRefundReceiptKeyOf,
  REFUND_RECEIPT_MAX_BYTES,
  REFUND_RECEIPT_UPLOAD_SECONDS,
  refundReceiptContentType,
  refundReceiptKey,
  type RefundReceiptContentType,
} from '../domain/refund-receipt';
import { ADMIN_BILLING_STORE, type AdminBillingStore } from './ports/admin-billing.store.port';
import { PAYMENT_LEDGER, type PaymentLedger } from './ports/payment-ledger.port';
import { REFUND_QUEUE, type RefundQueue } from './ports/refund-queue.port';
import { SyncPaymentWithGateway } from './sync-payment.use-case';

/**
 * As ações dos alertas de dinheiro (Backoffice - cobrança RN11; B10-3, B2-7 e
 * B3-1), só do Admin, com motivo e log.
 */
@Injectable()
export class AdminPaymentActions {
  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(PAYMENT_LEDGER) private readonly ledger: PaymentLedger,
    @Inject(REFUND_QUEUE) private readonly refunds: RefundQueue,
    @Inject(ADMIN_BILLING_STORE) private readonly store: AdminBillingStore,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly sync: SyncPaymentWithGateway,
  ) {}

  /** Aplicar mesmo assim: só com o `gateway_amount_mismatch` aberto (409 PAYMENT_NOT_MISMATCHED). */
  async applyAnyway(input: {
    paymentId: string;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<void> {
    const result = await this.sync.applyByAdmin(input);
    if (result === 'no_payment') throw new PaymentNotFoundError();
    if (result === 'not_applicable') throw new PaymentNotMismatchedError();
  }

  /**
   * Tentar o estorno de novo (o `refund_failed`): só em refund_requested com a
   * falha (409 REFUND_NOT_FAILED). A marca da desistência sai e o job, depois do
   * commit, consulta a cobrança antes de chamar a porta (Pagamentos e arrependimento RN05).
   */
  retryRefund({
    paymentId,
    adminUserId,
    reason,
    now,
  }: {
    paymentId: string;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<void> {
    return this.transaction.run(async () => {
      const locked = await this.ledger.lock({ paymentId });
      if (!locked) throw new PaymentNotFoundError();
      const { payment, wedding } = locked;
      if (payment.status !== 'refund_requested' || !payment.refundFailedAt)
        throw new RefundNotFailedError();
      await this.store.clearRefundFailure({
        paymentId,
        weddingId: wedding.id,
        adminUserId,
        reason,
        attempt: payment.refundAttempts + 1,
        now,
      });
      this.transaction.schedule(() =>
        this.refunds.enqueue({ paymentId, attempt: payment.refundAttempts + 1, delayMs: 0 }),
      );
    });
  }

  /**
   * A URL de envio do comprovante (decisão 259(1)): no padrão das Imagens,
   * presa à chave, ao tipo e ao tamanho, no bucket privado.
   */
  async authorizeReceiptUpload({
    paymentId,
    contentType,
    sizeBytes,
    now,
  }: {
    paymentId: string;
    contentType: RefundReceiptContentType;
    sizeBytes: number;
    now: Date;
  }): Promise<{ receiptKey: string; upload: PresignedPut }> {
    const status = await this.transaction.run(() => this.store.paymentStatus({ paymentId }));
    if (!status) throw new PaymentNotFoundError();
    if (status !== 'refund_requested') throw new RefundNotRequestedError();
    const receiptKey = refundReceiptKey({
      paymentId,
      token: randomBytes(16).toString('hex'),
      contentType,
    });
    const upload = await this.storage.presignPut({
      bucket: 'private',
      key: receiptKey,
      contentType,
      sizeBytes,
      now,
      expiresInSeconds: REFUND_RECEIPT_UPLOAD_SECONDS,
    });
    return { receiptKey, upload };
  }

  /**
   * Registrar reembolso feito por fora: a chave tem de ser deste pagamento e o
   * arquivo tem de ter chegado, até 10 MB (422 REFUND_RECEIPT_MISSING).
   */
  async recordManualRefund(input: {
    paymentId: string;
    adminUserId: string;
    reason: string;
    receiptKey: string;
    now: Date;
  }): Promise<void> {
    if (!isRefundReceiptKeyOf({ key: input.receiptKey, paymentId: input.paymentId }))
      throw new RefundReceiptMissingError();
    const head = await this.storage.head({ bucket: 'private', key: input.receiptKey });
    if (!head || head.sizeBytes > REFUND_RECEIPT_MAX_BYTES) throw new RefundReceiptMissingError();
    const result = await this.sync.recordManualRefund({ ...input, receipt: input.receiptKey });
    if (result === 'no_payment') throw new PaymentNotFoundError();
    if (result === 'not_applicable') throw new RefundNotRequestedError();
  }

  /** O comprovante, só para o Admin (decisão 259(1)). */
  async readReceipt({
    paymentId,
  }: {
    paymentId: string;
  }): Promise<{ body: Buffer; contentType: RefundReceiptContentType }> {
    const key = await this.transaction.run(() => this.store.receiptKeyOf({ paymentId }));
    if (key === undefined) throw new PaymentNotFoundError();
    if (!key) throw new RefundReceiptNotFoundError();
    const head = await this.storage.head({ bucket: 'private', key });
    if (!head) throw new RefundReceiptNotFoundError();
    return {
      body: await this.storage.get({ bucket: 'private', key }),
      contentType: refundReceiptContentType(key),
    };
  }
}
