export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Porta de envio de e-mail aos usuários (login, avisos ao casal e ao
 * cerimonialista). O Kore não envia e-mail a convidado.
 */
export interface EmailSender {
  send({ message }: { message: EmailMessage }): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EmailSender');
