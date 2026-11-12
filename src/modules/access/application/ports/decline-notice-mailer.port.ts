import type { AccessInvitationKind } from '../../domain/access-invitation';

export interface DeclineNotice {
  kind: AccessInvitationKind;
  to: string;
  /** Primeiro nome de quem convidou ("Olá, {Ana}."). */
  inviterName: string;
  /** Primeiro nome de quem recusou, ou o e-mail convidado (RN11; decisão 136). */
  declinedBy: string;
  /** Os primeiros nomes dos noivos, para o convite do casal. */
  partnerNames: [string, string];
  /** Dono → /app; indicador → /perfis (decisão 172, item 7). */
  inviterIsOwner: boolean;
}

/** E-mail 5 da Voz & Microcopy: aviso de convite recusado. */
export interface DeclineNoticeMailer {
  send({ notice }: { notice: DeclineNotice }): Promise<void>;
}

export const DECLINE_NOTICE_MAILER = Symbol('DeclineNoticeMailer');
