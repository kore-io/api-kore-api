import type { EmailMessage } from './email-sender.port';

/**
 * Fila do e-mail: `login` é prioritária e tem fila própria, para o código não
 * esperar atrás de outros envios (ADR do SES).
 */
export type EmailPriority = 'login' | 'default';

/**
 * Etiqueta de quem precisa saber se o worker desistir do e-mail depois das
 * tentativas (ex.: o aviso de exclusão, decisão 180(8)). Sem dados pessoais.
 */
export interface EmailTag {
  kind: string;
  data: Record<string, string>;
}

/** Porta usada pelos módulos para enviar e-mail: entra na fila e o worker envia. */
export interface EmailOutbox {
  /** Falha (fila e envio direto fora) vira erro para quem enfileirou. */
  enqueue({
    message,
    priority,
    tag,
  }: {
    message: EmailMessage;
    priority: EmailPriority;
    tag?: EmailTag;
  }): Promise<void>;
}

export const EMAIL_OUTBOX = Symbol('EmailOutbox');
