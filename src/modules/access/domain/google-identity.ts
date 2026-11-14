/** O que o Google confirma sobre a pessoa (OIDC). */
export interface GoogleIdentity {
  /** O `sub` do Google: estável mesmo se o e-mail da conta mudar. */
  subject: string;
  email: string;
  emailVerified: boolean;
  /**
   * A declaração `hd` do id_token (só nas contas do Google Workspace), em
   * minúsculas; o guard do Backoffice a compara com o GOOGLE_STAFF_DOMAIN (RN01).
   */
  hostedDomain: string | null;
}
