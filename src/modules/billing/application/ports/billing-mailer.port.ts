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

/** Os avisos de saída do ar (Data de saída do ar RN03): e-mail de serviço, sem valor de pagamento. */
export interface EndDateSoonNotice {
  to: string;
  firstName: string;
  /** AAAA-MM-DD. */
  endDate: string;
  /** O preço do mês a mais, da regra (o "R$ 29" do texto). */
  monthlyCents: number;
  partnerNames: [string, string];
}

export interface GraceNotice {
  to: string;
  /** O último dia no ar, AAAA-MM-DD. */
  graceUntil: string;
  partnerNames: [string, string];
}

export interface SiteExpiredNotice {
  to: string;
  /** AAAA-MM-DD. */
  expiredAt: string;
  /** Até quando dá para renovar (12 meses depois do casamento); nulo sem data. */
  renewUntil: string | null;
  partnerNames: [string, string];
}

/** O aviso de 30 dias antes do expurgo (Retenção e expurgo RN02): e-mail de serviço. */
export interface PurgeSoonNotice {
  to: string;
  firstName: string;
  /** Para a desistência do worker desfazer a marca do aviso (decisão 180(8)). */
  weddingId: string;
  noticeSentAt: Date;
  /** AAAA-MM-DD: o dia em que os dados são apagados. */
  purgeAt: string;
  /** AAAA-MM-DD: desde quando o site está fora do ar. */
  expiredAt: string;
  partnerNames: [string, string];
}

/** A exclusão pedida (Retenção e expurgo RN05): e-mail de serviço às pessoas donas. */
export interface DeletionScheduledNotice {
  to: string;
  firstName: string;
  /** O primeiro nome de quem pediu ("Ana pediu para excluir…"). */
  requesterFirstName: string;
  /** A versão de quem pediu ("Você pediu para excluir…"; decisão 252). */
  isRequester: boolean;
  /** AAAA-MM-DD. */
  deletionScheduledFor: string;
  partnerNames: [string, string];
}

export interface BillingMailer {
  paymentConfirmed({ notice }: { notice: PaymentConfirmedNotice }): Promise<void>;
  pixExpired({ notice }: { notice: PixExpiredNotice }): Promise<void>;
  refundCompleted({ notice }: { notice: RefundCompletedNotice }): Promise<void>;
  endDateSoon({ notice }: { notice: EndDateSoonNotice }): Promise<void>;
  graceStarted({ notice }: { notice: GraceNotice }): Promise<void>;
  siteExpired({ notice }: { notice: SiteExpiredNotice }): Promise<void>;
  purgeSoon({ notice }: { notice: PurgeSoonNotice }): Promise<void>;
  deletionScheduled({ notice }: { notice: DeletionScheduledNotice }): Promise<void>;
}

export const BILLING_MAILER = Symbol('BillingMailer');
