import { createHash } from 'node:crypto';
import { GoogleEmailUnverifiedError } from '../domain/access.errors';
import { CompleteGoogleLogin } from './complete-google-login.use-case';
import type { CompleteLogin } from './complete-login.use-case';
import type { GoogleIdentityProvider } from './ports/google-identity-provider.port';
import { StartGoogleLogin } from './start-google-login.use-case';

const now = new Date('2026-11-06T12:00:00.000Z');

function provider({ emailVerified = true }: { emailVerified?: boolean } = {}) {
  const authorizationUrl = jest.fn(
    ({ state }: { state: string }) => `https://google/auth?state=${state}`,
  );
  const exchangeCode = jest.fn().mockResolvedValue({
    subject: 'sub-123',
    email: 'Ana.Moreira@Gmail.com',
    emailVerified,
  });
  const google: GoogleIdentityProvider = { authorizationUrl, exchangeCode };
  return { google, authorizationUrl, exchangeCode };
}

describe('StartGoogleLogin', () => {
  it('dado o início do login, quando gera o pedido, então usa PKCE S256 e um state novo', () => {
    const { google, authorizationUrl } = provider();

    const { attempt } = new StartGoogleLogin(google).execute({
      origin: 'referral',
      next: '/app/convidados',
    });

    const challenge = createHash('sha256').update(attempt.codeVerifier).digest('base64url');
    expect(authorizationUrl).toHaveBeenCalledWith({
      state: attempt.state,
      codeChallenge: challenge,
    });
    expect(attempt).toMatchObject({ origin: 'referral', returnPath: '/app/convidados' });
    expect(attempt.state).not.toBe(
      new StartGoogleLogin(google).execute({ origin: 'none', next: undefined }).attempt.state,
    );
  });

  it('decisão 136 (7) - dada uma página de volta de outro site, quando começa, então ela é ignorada', () => {
    const { attempt } = new StartGoogleLogin(provider().google).execute({
      origin: 'none',
      next: '//evil.example/roubar',
    });

    expect(attempt.returnPath).toBeNull();
  });
});

describe('CompleteGoogleLogin', () => {
  const attempt = { state: 's', codeVerifier: 'cv', origin: 'invite' as const, returnPath: null };

  function build({ emailVerified }: { emailVerified: boolean }) {
    const { google, exchangeCode } = provider({ emailVerified });
    const execute = jest.fn().mockResolvedValue({ next: 'invite' });
    const completeLogin = { execute } as unknown as CompleteLogin;
    return { useCase: new CompleteGoogleLogin(google, completeLogin), exchangeCode, execute };
  }

  it('RN07 - dado o e-mail verificado pelo Google, quando volta, então entra pela conta do e-mail com o método google', async () => {
    const { useCase, exchangeCode, execute } = build({ emailVerified: true });

    await useCase.execute({ code: 'c', attempt, ip: '1.2.3.4', now });

    expect(exchangeCode).toHaveBeenCalledWith({ code: 'c', codeVerifier: 'cv' });
    expect(execute).toHaveBeenCalledWith({
      email: 'ana.moreira@gmail.com',
      method: 'google',
      providerSubject: 'sub-123',
      origin: 'invite',
      ip: '1.2.3.4',
      userAgent: undefined,
      now,
    });
  });

  it('dado um e-mail não verificado no Google, quando volta, então o login é recusado', async () => {
    const { useCase, execute } = build({ emailVerified: false });

    await expect(useCase.execute({ code: 'c', attempt, ip: null, now })).rejects.toThrow(
      GoogleEmailUnverifiedError,
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
