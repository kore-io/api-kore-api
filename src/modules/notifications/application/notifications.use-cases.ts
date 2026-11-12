import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import {
  NOTIFICATION_STORE,
  NOTIFICATION_TYPES,
  type EmailFrequency,
  type NotificationRow,
  type NotificationStore,
  type NotificationType,
  type PreferenceRow,
} from './ports/notification-store.port';

/** 20 por vez, com Carregar mais (Central RN06). */
const PAGE_SIZE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O padrão sem linha gravada (Central RN07): central sempre, e-mail no Resumo diário, push desligado. */
export const DEFAULT_PREFERENCE: Omit<PreferenceRow, 'type'> = {
  inApp: true,
  email: 'daily',
  push: false,
};

export class NotificationNotFoundError extends Error {
  override name = 'NotificationNotFoundError';
}

export class NotificationCursorInvalidError extends Error {
  override name = 'NotificationCursorInvalidError';
}

function encodeCursor({ row }: { row: NotificationRow }): string {
  return Buffer.from(`${row.updatedAt.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor({ cursor }: { cursor: string }): { updatedAt: Date; id: string } {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const updatedAt = new Date(at ?? '');
  if (Number.isNaN(updatedAt.getTime()) || !UUID.test(id ?? ''))
    throw new NotificationCursorInvalidError();
  return { updatedAt, id };
}

/**
 * A central do casamento ativo (Central RN04 a RN06 e RN09): só as notificações
 * da própria pessoa, e só enquanto ela tem vínculo com o casamento (sem
 * vínculo, 404). A RLS é a segunda barreira.
 */
@Injectable()
export class NotificationCenter {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(NOTIFICATION_STORE) private readonly store: NotificationStore,
  ) {}

  async list({
    userId,
    weddingId,
    type,
    cursor,
  }: {
    userId: string;
    weddingId: string;
    type: NotificationType | null;
    cursor?: string;
  }): Promise<{ items: NotificationRow[]; nextCursor: string | null }> {
    await this.authorization.require({ userId, weddingId, action: 'view' });
    const after = cursor === undefined ? null : decodeCursor({ cursor });
    const rows = await this.store.list({ userId, weddingId, type, after, limit: PAGE_SIZE + 1 });
    const items = rows.slice(0, PAGE_SIZE);
    return {
      items,
      nextCursor: rows.length > PAGE_SIZE ? encodeCursor({ row: items[items.length - 1] }) : null,
    };
  }

  /** O sino (RN06; R7-5): barato, pelo índice parcial das não lidas. */
  async unreadCount({ userId, weddingId }: { userId: string; weddingId: string }): Promise<number> {
    await this.authorization.require({ userId, weddingId, action: 'view' });
    return this.store.unreadCount({ userId, weddingId });
  }

  /** Abrir marca como lida (RN05); a de outra pessoa, ou sem vínculo, é 404. */
  async read({ userId, id, now }: { userId: string; id: string; now: Date }): Promise<void> {
    if (!(await this.store.markRead({ userId, id, now }))) throw new NotificationNotFoundError();
  }

  /** Marcar todas como lidas (RN06). */
  async readAll({
    userId,
    weddingId,
    now,
  }: {
    userId: string;
    weddingId: string;
    now: Date;
  }): Promise<void> {
    await this.authorization.require({ userId, weddingId, action: 'view' });
    await this.store.markAllRead({ userId, weddingId, now });
  }
}

export interface PreferencesView {
  /** Uma linha por tipo da fase, com o padrão quando não há linha gravada. */
  items: PreferenceRow[];
  push: {
    /** Este aparelho (a sessão) tem assinatura de push (RN07; 217(8)). */
    subscribed: boolean;
    /** A chave pública VAPID; nula com o push desligado no ambiente. */
    vapidPublicKey: string | null;
  };
}

/** Configurações › Notificações (Central RN07): cada pessoa, só as suas, por casamento. */
@Injectable()
export class NotificationPreferences {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(NOTIFICATION_STORE) private readonly store: NotificationStore,
  ) {}

  async get({
    userId,
    sessionId,
    weddingId,
  }: {
    userId: string;
    sessionId: string;
    weddingId: string;
  }): Promise<PreferencesView> {
    await this.authorization.require({ userId, weddingId, action: 'view' });
    const saved = new Map(
      (await this.store.preferences({ userId, weddingId })).map((row) => [row.type, row]),
    );
    return {
      items: NOTIFICATION_TYPES.map((type) => saved.get(type) ?? { type, ...DEFAULT_PREFERENCE }),
      push: {
        subscribed: await this.store.hasPushSubscription({ sessionId }),
        // A chave VAPID entra com o push (E-mail e push RN07); até lá, desligado.
        vapidPublicKey: null,
      },
    };
  }

  /** Grava o e-mail do tipo na hora; o push muda pela assinatura do aparelho. */
  async saveEmail({
    userId,
    weddingId,
    type,
    email,
  }: {
    userId: string;
    weddingId: string;
    type: NotificationType;
    email: EmailFrequency;
  }): Promise<PreferenceRow> {
    await this.authorization.require({ userId, weddingId, action: 'view' });
    return this.store.saveEmailPreference({ userId, weddingId, type, email });
  }
}
