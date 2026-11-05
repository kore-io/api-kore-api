/** Segredos do pedido de login: o token do botão e o código de 6 números. */
export interface LoginChallengeSecrets {
  issue(): { token: string; tokenHash: string; code: string; codeHash: string };
  hashToken({ token }: { token: string }): string;
  matchesCode({ code, codeHash }: { code: string; codeHash: string }): boolean;
}

export const LOGIN_CHALLENGE_SECRETS = Symbol('LoginChallengeSecrets');
