import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { coupleNames } from '../../site/domain/public-site';
import {
  LINK_PLACEHOLDER,
  MESSAGE_KINDS,
  defaultMessage,
  requiresLink,
  type MessageKind,
} from '../domain/message-templates';
import { LinkPlaceholderMissingError } from '../domain/rsvp.errors';
import {
  MESSAGE_TEMPLATE_STORE,
  type MessageTemplateStore,
  type MessageWedding,
} from './ports/message-template-store.port';

export interface MessageTemplateView {
  kind: MessageKind;
  /** O assunto do e-mail; o padrão quando o casal não escreveu um. */
  subject: string;
  body: string;
  /** Sem mensagem guardada: vale o padrão. */
  isDefault: boolean;
}

/**
 * As mensagens prontas do casamento (Envios RN06): a guardada ou, sem ela, a
 * padrão. O assunto vazio vale o assunto padrão. Também é a fonte da mensagem
 * da fila de envio (PR dos envios).
 */
@Injectable()
export class MessageTemplates {
  constructor(@Inject(MESSAGE_TEMPLATE_STORE) private readonly store: MessageTemplateStore) {}

  async all({ weddingId }: { weddingId: string }): Promise<MessageTemplateView[]> {
    const wedding = await this.wedding({ weddingId });
    const stored = new Map(
      (await this.store.list({ weddingId })).map((template) => [template.kind, template]),
    );
    return MESSAGE_KINDS.map((kind) => {
      const fallback = this.fallback({ kind, wedding });
      const saved = stored.get(kind);
      return saved
        ? { kind, subject: saved.subject ?? fallback.subject, body: saved.body, isDefault: false }
        : { kind, ...fallback, isDefault: true };
    });
  }

  private async wedding({ weddingId }: { weddingId: string }): Promise<MessageWedding> {
    const wedding = await this.store.wedding({ weddingId });
    if (!wedding) throw new Error('Casamento sem leitura na transação do vínculo.');
    return wedding;
  }

  private fallback({ kind, wedding }: { kind: MessageKind; wedding: MessageWedding }) {
    return defaultMessage({
      kind,
      city: wedding.city,
      coupleNames: coupleNames({ partners: wedding.partners }),
      hasDeadline: wedding.rsvpDeadline !== null,
    });
  }
}

/** GET …/message-templates (Envios RN06): `manage_guests` (o dono e a colaboradora, RN02). */
@Injectable()
export class ListMessageTemplates {
  constructor(
    private readonly authorization: WeddingAuthorization,
    private readonly templates: MessageTemplates,
  ) {}

  async execute({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<MessageTemplateView[]> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    return this.templates.all({ weddingId });
  }
}

/**
 * PUT …/message-templates/{kind} (Envios RN06): grava a mensagem para os
 * próximos envios, ou `reset` volta ao padrão. O convite e o lembrete precisam
 * do {link} (422 LINK_PLACEHOLDER_MISSING). Os tamanhos e a quebra de linha
 * no assunto são do DTO.
 */
@Injectable()
export class SaveMessageTemplate {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(MESSAGE_TEMPLATE_STORE) private readonly store: MessageTemplateStore,
    private readonly templates: MessageTemplates,
  ) {}

  async execute({
    userId,
    weddingId,
    kind,
    input,
  }: {
    userId: string;
    weddingId: string;
    kind: MessageKind;
    input: { reset: true } | { subject: string | null; body: string };
  }): Promise<MessageTemplateView> {
    await this.authorization.require({ userId, weddingId, action: 'manage_guests' });
    if ('reset' in input) await this.store.remove({ weddingId, kind });
    else {
      if (requiresLink({ kind }) && !input.body.includes(LINK_PLACEHOLDER))
        throw new LinkPlaceholderMissingError();
      await this.store.save({ weddingId, kind, subject: input.subject, body: input.body, userId });
    }
    const views = await this.templates.all({ weddingId });
    return views.find((view) => view.kind === kind)!;
  }
}
