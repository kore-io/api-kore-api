import { isRefundReceiptKeyOf, pastGatewayWindow, refundReceiptKey } from './refund-receipt';

const DAY = 86_400_000;

describe('Comprovante e prazo do gateway (Backoffice - cobrança RN05 e RN11; decisão 259)', () => {
  it('RN05 (B3-6) - Pix com mais de 90 dias passou do prazo; cartão nunca, até a conta do Asaas confirmar', () => {
    const now = new Date('2026-11-14T12:00:00Z');
    expect(
      pastGatewayWindow({ method: 'pix', paidAt: new Date(now.getTime() - 91 * DAY), now }),
    ).toBe(true);
    expect(
      pastGatewayWindow({ method: 'pix', paidAt: new Date(now.getTime() - 89 * DAY), now }),
    ).toBe(false);
    expect(
      pastGatewayWindow({ method: 'card', paidAt: new Date(now.getTime() - 400 * DAY), now }),
    ).toBe(false);
  });

  it('RN11 - a chave do comprovante é do pagamento e tem a forma dada pela API', () => {
    const paymentId = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    const key = refundReceiptKey({
      paymentId,
      token: 'a'.repeat(32),
      contentType: 'application/pdf',
    });
    expect(isRefundReceiptKeyOf({ key, paymentId })).toBe(true);
    expect(isRefundReceiptKeyOf({ key, paymentId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c' })).toBe(
      false,
    );
    expect(isRefundReceiptKeyOf({ key: `${key}/../x`, paymentId })).toBe(false);
  });
});
