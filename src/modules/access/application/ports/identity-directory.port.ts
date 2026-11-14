import type { AuthMethod } from '../../domain/authenticated-session';

/**
 * As formas de entrar da conta (Configurações › Acesso; decisão 254): os
 * provedores das AuthIdentity, sem repetir, na ordem em que nasceram. Sem o
 * e-mail do Google nem os ids.
 */
export interface IdentityDirectory {
  providers({ userId }: { userId: string }): Promise<AuthMethod[]>;
}

export const IDENTITY_DIRECTORY = Symbol('IdentityDirectory');
