import type { AccessInvitationKind } from '../../domain/access-invitation';
import type { Inviter, InvitationWeddingDetails } from './access-invitation-store.port';

export interface InvitationEmail {
  kind: AccessInvitationKind;
  to: string;
  token: string;
  /** Reenvio ou Convidar outro e-mail (RN04): o e-mail avisa que o link anterior caiu. */
  resent: boolean;
  message: string | null;
  wedding: InvitationWeddingDetails;
  inviter: Inviter;
}

/** E-mails 2, 3 e 4 da Voz & Microcopy (convites de acesso) e o link do convite. */
export interface InvitationMailer {
  send({ email }: { email: InvitationEmail }): Promise<void>;
  /** APP_URL + /convite/{token} (decisão 139). */
  urlFor({ token }: { token: string }): string;
}

export const INVITATION_MAILER = Symbol('InvitationMailer');
