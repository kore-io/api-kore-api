import type { PaymentsCsvRow } from '../../domain/payments-csv';
import type { Page } from './admin-weddings.reader.port';

/** Os status do filtro da Cobrança (RN03): "Falhou" é o "Não aprovado" do casal. */
export const ADMIN_PAYMENT_STATUSES = [
  'pending',
  'paid',
  'failed',
  'refund_requested',
  'refunded',
  'disputed',
] as const;
export type AdminPaymentStatus = (typeof ADMIN_PAYMENT_STATUSES)[number];

export interface AdminPaymentQuery {
  status?: AdminPaymentStatus;
  kind?: 'publication' | 'extension';
  method?: 'pix' | 'card';
  /** Pelo pagamento (ou a criação, sem pagamento). */
  from?: Date;
  to?: Date;
  page: number;
}

export interface AdminPaymentRow {
  id: string;
  /** "P-0431". */
  code: string;
  weddingId: string;
  coupleNames: string | null;
  kind: string;
  amountCents: number;
  method: string;
  status: string;
  /** Recebido e não aplicado (o pagamento sem destino, Publicar e pagar RN08). */
  applied: boolean;
  refundOrigin: string | null;
  createdAt: Date;
  paidAt: Date | null;
}

export interface AdminPaymentDetail extends AdminPaymentRow {
  installments: number;
  monthsCovered: number;
  periodStart: string;
  periodEnd: string;
  activationListCents: number;
  monthlyListCents: number;
  /** "Preço máximo": o quanto o teto da publicação cortou. */
  capDiscountCents: number;
  referralDiscountCents: number;
  pixDiscountCents: number;
  installmentInterestCents: number;
  gatewayFeeCents: number | null;
  netCents: number | null;
  /** "CPF final 4821". */
  payerTaxIdLast4: string;
  gatewayPaymentId: string | null;
  appliedAt: Date | null;
  appliedByAdminAt: Date | null;
  referrer: { id: string; name: string } | null;
  commission: { amountCents: number; ratePercent: number; status: string } | null;
  refund: {
    origin: string | null;
    requestedAt: Date | null;
    /** O texto do casal (Arrependimento), ou o motivo do Admin, do log. */
    reason: string | null;
    attempts: number;
    lastError: string | null;
    failedAt: Date | null;
    refundedAt: Date | null;
    outsideGateway: boolean;
  };
  dispute: { disputedAt: Date | null; deadline: string | null };
}

/** A Cobrança do Backoffice (RN02 a RN04), pela conexão do backoffice; só o Admin. */
export interface AdminPaymentsReader {
  list(query: AdminPaymentQuery): Promise<Page<AdminPaymentRow>>;
  detail(input: { paymentId: string }): Promise<AdminPaymentDetail | null>;
  /** O CSV do período (RN07): os pagos no período e os estornados no período. */
  exportRows(input: { from: Date; to: Date }): Promise<PaymentsCsvRow[]>;
  /** A aba Cobrança do casamento: os pagamentos (com a comissão) e as cortesias. */
  ofWedding(input: { weddingId: string }): Promise<{
    payments: (AdminPaymentRow & {
      commission: { amountCents: number; status: string; referrerName: string } | null;
    })[];
    courtesies: {
      id: string;
      months: number;
      createdAt: Date;
      adminName: string | null;
      newEndDate: string;
    }[];
  } | null>;
}

export const ADMIN_PAYMENTS_READER = Symbol('AdminPaymentsReader');
