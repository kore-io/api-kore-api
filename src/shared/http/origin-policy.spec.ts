import { evaluateOrigin } from './origin-policy';

const allowedOrigins = ['https://app.kore.com.br'];

describe('evaluateOrigin (proteção contra CSRF)', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'dada uma leitura (%s) de outra origem, quando avalia, então deixa passar',
    (method) => {
      expect(
        evaluateOrigin({
          method,
          origin: 'https://evil.example',
          hasSessionCookie: true,
          allowedOrigins,
        }),
      ).toBe('allow');
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'dada uma escrita (%s) de outra origem, quando avalia, então recusa',
    (method) => {
      expect(
        evaluateOrigin({
          method,
          origin: 'https://evil.example',
          hasSessionCookie: true,
          allowedOrigins,
        }),
      ).toBe('reject');
    },
  );

  it('dada uma escrita da origem do app, quando avalia, então deixa passar', () => {
    expect(
      evaluateOrigin({
        method: 'POST',
        origin: 'https://app.kore.com.br',
        hasSessionCookie: true,
        allowedOrigins,
      }),
    ).toBe('allow');
  });

  it('dada uma escrita com Origin null (redirecionamento ou iframe isolado), quando avalia, então recusa', () => {
    expect(
      evaluateOrigin({ method: 'POST', origin: 'null', hasSessionCookie: false, allowedOrigins }),
    ).toBe('reject');
  });

  it('dada uma escrita sem Origin e com cookie de sessão, quando avalia, então recusa', () => {
    expect(
      evaluateOrigin({ method: 'POST', origin: undefined, hasSessionCookie: true, allowedOrigins }),
    ).toBe('reject');
  });

  it('dada uma escrita sem Origin e sem cookie (cliente fora do navegador), quando avalia, então deixa passar', () => {
    expect(
      evaluateOrigin({
        method: 'POST',
        origin: undefined,
        hasSessionCookie: false,
        allowedOrigins,
      }),
    ).toBe('allow');
  });
});
