import type { GoogleIdentity } from '../../domain/google-identity';

/**
 * Login pelo Google (OIDC com PKCE). No local e nos testes, um provedor de
 * desenvolvimento simula a volta do Google sem credencial (decisões 96 e 147).
 */
export interface GoogleIdentityProvider {
  authorizationUrl({ state, codeChallenge }: { state: string; codeChallenge: string }): string;
  exchangeCode({
    code,
    codeVerifier,
  }: {
    code: string;
    codeVerifier: string;
  }): Promise<GoogleIdentity>;
}

export const GOOGLE_IDENTITY_PROVIDER = Symbol('GoogleIdentityProvider');
