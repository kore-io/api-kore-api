import type { MessageKind } from '../../domain/message-templates';

export interface StoredMessageTemplate {
  kind: MessageKind;
  subject: string | null;
  body: string;
}

/** O que a mensagem padrão usa do casamento (Envios RN06). */
export interface MessageWedding {
  city: string;
  partners: string[];
  /** AAAA-MM-DD; nulo sem prazo. */
  rsvpDeadline: string | null;
}

/** Mensagens prontas, na transação da requisição (RLS do vínculo). */
export interface MessageTemplateStore {
  wedding({ weddingId }: { weddingId: string }): Promise<MessageWedding | null>;
  list({ weddingId }: { weddingId: string }): Promise<StoredMessageTemplate[]>;
  save({
    weddingId,
    kind,
    subject,
    body,
    userId,
  }: {
    weddingId: string;
    kind: MessageKind;
    subject: string | null;
    body: string;
    userId: string;
  }): Promise<void>;
  /** Restaurar a mensagem padrão: sem linha, vale o padrão. */
  remove({ weddingId, kind }: { weddingId: string; kind: MessageKind }): Promise<void>;
}

export const MESSAGE_TEMPLATE_STORE = Symbol('MessageTemplateStore');
