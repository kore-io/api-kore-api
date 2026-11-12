/** O nome da conta: gravado no aceite e lido para o aviso de recusa (decisões 136 e 168). */
export interface UserAccountNames {
  setName({ userId, name }: { userId: string; name: string }): Promise<void>;
  nameByEmail({ email }: { email: string }): Promise<string | null>;
}

export const USER_ACCOUNT_NAMES = Symbol('UserAccountNames');
