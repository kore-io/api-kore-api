import type { EmailMessage } from './email-sender.port';

/**
 * Fila do e-mail: `login` é prioritária e tem fila própria, para o código não
 * esperar atrás de outros envios (ADR do SES).
 */
export type EmailPriority = 'login' | 'default';

/** Porta usada pelos módulos para enviar e-mail: entra na fila e o worker envia. */
export interface EmailOutbox {
  enqueue({ message, priority }: { message: EmailMessage; priority: EmailPriority }): Promise<void>;
}

export const EMAIL_OUTBOX = Symbol('EmailOutbox');
