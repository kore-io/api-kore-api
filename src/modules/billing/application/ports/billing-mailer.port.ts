/** O e-mail de pagamento confirmado (Publicar e pagar RN13), sem valor (decisão 230, D23). */
export interface PaymentConfirmedNotice {
  to: string;
  firstName: string;
  /** AAAA-MM-DD. */
  endDate: string;
  partnerNames: [string, string];
}

/** O e-mail do Pix vencido (Publicar e pagar RN11 e RN13), sem valor. */
export interface PixExpiredNotice {
  to: string;
  partnerNames: [string, string];
}

/** O e-mail do reembolso concluído (Pagamentos e arrependimento RN07), sem valor. */
export interface RefundCompletedNotice {
  to: string;
  firstName: string;
  partnerNames: [string, string];
}

export interface BillingMailer {
  paymentConfirmed({ notice }: { notice: PaymentConfirmedNotice }): Promise<void>;
  pixExpired({ notice }: { notice: PixExpiredNotice }): Promise<void>;
  refundCompleted({ notice }: { notice: RefundCompletedNotice }): Promise<void>;
}

export const BILLING_MAILER = Symbol('BillingMailer');
