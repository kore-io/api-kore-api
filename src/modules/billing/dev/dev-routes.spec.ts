import { devPaymentRoutesEnabled } from './dev-routes';

describe('devPaymentRoutesEnabled (Publicar e pagar RN15)', () => {
  it.each(['local', 'test'])('RN15 - com APP_ENV %s, a rota dev existe', (APP_ENV) => {
    expect(devPaymentRoutesEnabled({ APP_ENV })).toBe(true);
  });

  it.each(['homolog', 'production', undefined])(
    'RN15 - com APP_ENV %s, o módulo da rota dev nem é registrado (404)',
    (APP_ENV) => {
      expect(devPaymentRoutesEnabled({ APP_ENV })).toBe(false);
    },
  );
});
