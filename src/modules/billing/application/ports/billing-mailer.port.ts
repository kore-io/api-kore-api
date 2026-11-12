/** O e-mail de pagamento confirmado (Publicar e pagar RN13), sem valor (decisão 230, D23). */
export interface PaymentConfirmedNotice {
  to: string;
  firstName: string;
  /** AAAA-MM-DD. */
  endDate: string;
  partnerNames: [string, string];
}

export interface BillingMailer {
  paymentConfirmed({ notice }: { notice: PaymentConfirmedNotice }): Promise<void>;
}

export const BILLING_MAILER = Symbol('BillingMailer');
