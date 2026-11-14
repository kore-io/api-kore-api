import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { GoogleIdentityProvider } from '../application/ports/google-identity-provider.port';
import type { GoogleIdentity } from '../domain/google-identity';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/** Google real (OIDC, code flow com PKCE). O id_token é conferido pela assinatura. */
export class GoogleOidcProvider implements GoogleIdentityProvider {
  constructor(
    private readonly options: { clientId: string; clientSecret: string; redirectUri: string },
  ) {}

  authorizationUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string {
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      response_type: 'code',
      scope: 'openid email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  async exchangeCode({
    code,
    codeVerifier,
  }: {
    code: string;
    codeVerifier: string;
  }): Promise<GoogleIdentity> {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        code_verifier: codeVerifier,
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        redirect_uri: this.options.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!response.ok) throw new Error(`Google recusou o código (HTTP ${response.status}).`);
    const { id_token: idToken } = (await response.json()) as { id_token?: string };
    if (!idToken) throw new Error('Google não devolveu o id_token.');

    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: ISSUERS,
      audience: this.options.clientId,
    });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      throw new Error('id_token sem sub ou e-mail.');
    }
    return {
      subject: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      hostedDomain: typeof payload.hd === 'string' ? payload.hd.toLowerCase() : null,
    };
  }
}
