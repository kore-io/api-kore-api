export interface UserAccount {
  id: string;
  email: string;
  status: 'active' | 'blocked';
}

export interface UserAccounts {
  findByEmail({ email }: { email: string }): Promise<UserAccount | null>;
  /** Cria a conta; se outra requisição criou o mesmo e-mail antes, devolve a existente. */
  createOrGet({ email }: { email: string }): Promise<{ account: UserAccount; created: boolean }>;
  /** Garante o método de login (RN07: um usuário pode ter e-mail e Google). */
  ensureIdentity({
    userId,
    provider,
    providerSubject,
  }: {
    userId: string;
    provider: 'email' | 'google';
    providerSubject: string;
  }): Promise<void>;
  recordLogin({ userId, now }: { userId: string; now: Date }): Promise<void>;
}

export const USER_ACCOUNTS = Symbol('UserAccounts');
