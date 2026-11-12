import { evaluateOrigin, originsFor } from './origin-policy';
import { hasCredentialCookie } from './session-cookie-name';

const allowedOrigins = ['https://app.kore.com.br'];

describe('evaluateOrigin (proteção contra CSRF)', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'dada uma leitura (%s) de outra origem, quando avalia, então deixa passar',
    (method) => {
      expect(
        evaluateOrigin({
          method,
          origin: 'https://evil.example',
          hasCredential: true,
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
          hasCredential: true,
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
        hasCredential: true,
        allowedOrigins,
      }),
    ).toBe('allow');
  });

  it('dada uma escrita com Origin null (redirecionamento ou iframe isolado), quando avalia, então recusa', () => {
    expect(
      evaluateOrigin({ method: 'POST', origin: 'null', hasCredential: false, allowedOrigins }),
    ).toBe('reject');
  });

  it('dada uma escrita sem Origin e com cookie de sessão, quando avalia, então recusa', () => {
    expect(
      evaluateOrigin({ method: 'POST', origin: undefined, hasCredential: true, allowedOrigins }),
    ).toBe('reject');
  });

  it('dada uma escrita sem Origin e sem cookie (cliente fora do navegador), quando avalia, então deixa passar', () => {
    expect(
      evaluateOrigin({
        method: 'POST',
        origin: undefined,
        hasCredential: false,
        allowedOrigins,
      }),
    ).toBe('allow');
  });
});

describe('Origem por rota e credenciais (Site público RN07; decisão 207, item 4)', () => {
  const appOrigins = ['https://app.kore.com.br'];
  const siteOrigin = 'https://kore.com.br';

  it('RN07 - a origem do site só vale nas rotas do site; a do app, nas duas', () => {
    const app = originsFor({ isSiteRoute: false, appOrigins, siteOrigin });
    const site = originsFor({ isSiteRoute: true, appOrigins, siteOrigin });

    expect(
      evaluateOrigin({
        method: 'POST',
        origin: siteOrigin,
        hasCredential: true,
        allowedOrigins: app,
      }),
    ).toBe('reject');
    expect(
      evaluateOrigin({
        method: 'POST',
        origin: siteOrigin,
        hasCredential: true,
        allowedOrigins: site,
      }),
    ).toBe('allow');
    expect(
      evaluateOrigin({
        method: 'POST',
        origin: appOrigins[0],
        hasCredential: true,
        allowedOrigins: site,
      }),
    ).toBe('allow');
  });

  it.each([
    ['a sessão', { kore_session: 'x' }],
    ['o cookie do grupo', { 'kore_party_0195b2e4-0000-7000-8000-000000000000': 'x' }],
    ['o cookie da prévia', { 'kore_site_preview_0195b2e4-0000-7000-8000-000000000000': 'x' }],
  ])('RN07 - escrita sem Origin e com %s: recusa', (_, cookies) => {
    expect(
      evaluateOrigin({
        method: 'POST',
        origin: undefined,
        hasCredential: hasCredentialCookie({ cookies }),
        allowedOrigins: appOrigins,
      }),
    ).toBe('reject');
  });

  it('RN07 - escrita sem Origin e sem credencial (cookie que não é do Kore): passa', () => {
    expect(
      evaluateOrigin({
        method: 'POST',
        origin: undefined,
        hasCredential: hasCredentialCookie({ cookies: { _ga: 'x', kore_last_profile: 'couple' } }),
        allowedOrigins: appOrigins,
      }),
    ).toBe('allow');
  });
});
