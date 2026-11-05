/** Token do link do convite: só o hash vai ao banco (RN03 de Convites). */
export interface InvitationTokens {
  generate(): { token: string; tokenHash: string };
  hash({ token }: { token: string }): string;
}

export const INVITATION_TOKENS = Symbol('InvitationTokens');
