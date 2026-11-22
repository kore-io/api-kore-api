/**
 * O comprovante do Reembolso feito por fora (Backoffice - cobrança RN11;
 * decisão 259(1)): upload no padrão das Imagens, PDF, JPG ou PNG até 10 MB,
 * no bucket privado, lido só pelo Admin.
 */
export const REFUND_RECEIPT_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type RefundReceiptContentType = (typeof REFUND_RECEIPT_CONTENT_TYPES)[number];
export const REFUND_RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const REFUND_RECEIPT_UPLOAD_SECONDS = 5 * 60;

const PREFIX = 'refund-receipts';

export const refundReceiptKey = ({
  paymentId,
  token,
  contentType,
}: {
  paymentId: string;
  token: string;
  contentType: RefundReceiptContentType;
}) =>
  `${PREFIX}/${paymentId}/${token}.${contentType === 'application/pdf' ? 'pdf' : contentType === 'image/png' ? 'png' : 'jpg'}`;

/** A chave é deste pagamento e tem a forma que a API deu (nunca uma chave qualquer). */
export const isRefundReceiptKeyOf = ({ key, paymentId }: { key: string; paymentId: string }) =>
  new RegExp(`^${PREFIX}/${paymentId}/[0-9a-f]{32}\\.(pdf|png|jpg)$`).test(key);

export const refundReceiptContentType = (key: string): RefundReceiptContentType =>
  key.endsWith('.pdf') ? 'application/pdf' : key.endsWith('.png') ? 'image/png' : 'image/jpeg';

/**
 * O prazo de estorno do gateway, em dias desde o pagamento (Backoffice -
 * cobrança RN05, B3-6; decisão 259(2)): Pix 90; cartão a confirmar na conta do
 * Asaas (decisão 231), e até lá `null` (nunca passa).
 */
export const GATEWAY_REFUND_WINDOW_DAYS: Record<'pix' | 'card', number | null> = {
  pix: 90,
  card: null,
};

export function pastGatewayWindow({
  method,
  paidAt,
  now,
}: {
  method: 'pix' | 'card';
  paidAt: Date | null;
  now: Date;
}): boolean {
  const days = GATEWAY_REFUND_WINDOW_DAYS[method];
  if (days === null || !paidAt) return false;
  return now.getTime() - paidAt.getTime() > days * 86_400_000;
}
