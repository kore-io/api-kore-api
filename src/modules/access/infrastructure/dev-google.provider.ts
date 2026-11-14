import type { AppEnv } from '../../../shared/config/env.schema';
import type { GoogleIdentityProvider } from '../application/ports/google-identity-provider.port';
import type { GoogleIdentity } from '../domain/google-identity';

export const DEV_GOOGLE_PATH = '/v1/auth/google/dev';
const DEV_ENVS: readonly AppEnv[] = ['local', 'test'];
const CONSUMER_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Provedor de desenvolvimento (decisões 96 e 147): simula a volta do Google
 * sem credencial. O "código" carrega o e-mail escolhido no formulário do
 * /v1/auth/google/dev. Só sobe em local e test.
 */
export class DevGoogleProvider implements GoogleIdentityProvider {
  constructor({ appEnv }: { appEnv: AppEnv }) {
    // Segunda barreira, além da validação do env: nunca sobe fora de local/test.
    if (!DEV_ENVS.includes(appEnv))
      throw new Error(`Google de desenvolvimento recusado com APP_ENV ${appEnv}.`);
  }

  authorizationUrl({ state }: { state: string }): string {
    return `${DEV_GOOGLE_PATH}?${new URLSearchParams({ state }).toString()}`;
  }

  static codeFor({ email, verified }: { email: string; verified: boolean }): string {
    return Buffer.from(JSON.stringify({ email, verified })).toString('base64url');
  }

  exchangeCode({ code }: { code: string }): Promise<GoogleIdentity> {
    const { email, verified } = JSON.parse(Buffer.from(code, 'base64url').toString()) as {
      email: string;
      verified: boolean;
    };
    // Como o Google: o hd só vem nas contas do Workspace (aqui, todo domínio que
    // não é do Gmail), para o Backoffice ser testável no local (RN01).
    const domain = email.toLowerCase().split('@')[1] ?? '';
    return Promise.resolve({
      subject: `dev:${email.toLowerCase()}`,
      email,
      emailVerified: verified,
      hostedDomain: domain && !CONSUMER_DOMAINS.has(domain) ? domain : null,
    });
  }
}
