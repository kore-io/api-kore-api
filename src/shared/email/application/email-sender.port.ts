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
  /**
   * O Testar conexão do Backoffice (Backoffice - cobrança RN10; B10-8): só
   * confere que o serviço responde, sem enviar nada. Falha com erro.
   */
  ping(): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EmailSender');
