import type { LocalGatewayStore } from './local-gateway.store';
import { LOCAL_WEBHOOK_TOKEN_HEADER, LocalPaymentGateway } from './local-payment-gateway';

const secret = 'local-webhook-secret-only-for-dev-and-tests-0001';
const store = {} as LocalGatewayStore;

describe('LocalPaymentGateway (Publicar e pagar RN14 e RN16)', () => {
  it.each(['homolog', 'production'] as const)(
    'RN16 - a barreira do construtor recusa APP_ENV %s',
    (appEnv) => {
      expect(() => new LocalPaymentGateway(store, { appEnv, webhookSecret: secret })).toThrow(
        /recusado/,
      );
    },
  );

  describe('verifyWebhook (RN09)', () => {
    const gateway = new LocalPaymentGateway(store, { appEnv: 'test', webhookSecret: secret });
    const body = {
      id: 'evt_1',
      type: 'charge.confirmed',
      externalReference: 'pay-1',
      gatewayPaymentId: 'pay_local_1',
      chargedCents: 33710,
      feeCents: 199,
      netCents: 33511,
      // Campos fora da lista não passam (RN02; B2-13).
      payerTaxId: '52998224725',
    };
    const verify = (token: string | undefined, raw: string = JSON.stringify(body)) =>
      gateway.verifyWebhook({
        headers: { [LOCAL_WEBHOOK_TOKEN_HEADER]: token },
        rawBody: Buffer.from(raw),
      });

    it('RN09 - segredo errado, curto ou ausente: assinatura inválida', () => {
      expect(verify('outro-segredo')).toEqual({ kind: 'invalid_signature' });
      expect(verify(secret.slice(0, 10))).toEqual({ kind: 'invalid_signature' });
      expect(verify(undefined)).toEqual({ kind: 'invalid_signature' });
    });

    it('RN09 - corpo ilegível ou tipo desconhecido: malformado', () => {
      expect(verify(secret, '{')).toEqual({ kind: 'malformed' });
      expect(verify(secret, JSON.stringify({ ...body, type: 'payment.weird' }))).toEqual({
        kind: 'malformed',
      });
    });

    it('B2-15 - devolve o evento normalizado, só com os campos permitidos', () => {
      expect(verify(secret)).toEqual({
        kind: 'event',
        event: {
          gatewayEventId: 'evt_1',
          type: 'charge.confirmed',
          externalReference: 'pay-1',
          gatewayPaymentId: 'pay_local_1',
          chargedCents: 33710,
          feeCents: 199,
          netCents: 33511,
        },
      });
    });
  });
});
