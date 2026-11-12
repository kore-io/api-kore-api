/** O que o Google confirma sobre a pessoa (OIDC). */
export interface GoogleIdentity {
  /** O `sub` do Google: estável mesmo se o e-mail da conta mudar. */
  subject: string;
  email: string;
  emailVerified: boolean;
}
