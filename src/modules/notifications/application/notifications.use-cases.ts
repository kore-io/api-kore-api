import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import {
  PLANNER_PROFILES,
  type PlannerProfiles,
} from '../../access/application/ports/planner-profiles.port';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { ProfileNotOwnedError } from '../../access/domain/access.errors';
import {
  NOTIFICATION_STORE,
  NOTIFICATION_TYPES,
  PLANNER_NOTIFICATION_TYPES,
  type EmailFrequency,
  type NotificationRow,
  type NotificationStore,
  type NotificationType,
  type PlannerNotificationType,
  type PreferenceRow,
} from './ports/notification-store.port';

/**
 * As rotas da cerimonialista exigem ter o perfil (Notificações da
 * cerimonialista RN05; decisão 224(3)): sem ele, 403 PROFILE_NOT_OWNED.
 */
async function requirePlannerProfile({
  profiles,
  userId,
}: {
  profiles: PlannerProfiles;
  userId: string;
}): Promise<void> {
  if (!(await profiles.findOwn({ userId }))) throw new ProfileNotOwnedError();
}

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
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
  ) {}

  /**
   * A central da cerimonialista (`scope=planner`; Notificações da cerimonialista
   * RN05): todos os casamentos dela numa página, sem o de que é dona.
   */
  async listPlanner({
    userId,
    type,
    cursor,
  }: {
    userId: string;
    type: PlannerNotificationType | null;
    cursor?: string;
  }): Promise<{ items: NotificationRow[]; nextCursor: string | null }> {
    await requirePlannerProfile({ profiles: this.profiles, userId });
    const after = cursor === undefined ? null : decodeCursor({ cursor });
    const rows = await this.store.listPlanner({ userId, type, after, limit: PAGE_SIZE + 1 });
    const items = rows.slice(0, PAGE_SIZE);
    return {
      items,
      nextCursor: rows.length > PAGE_SIZE ? encodeCursor({ row: items[items.length - 1] }) : null,
    };
  }

  /** O sino dela, com o mesmo escopo (RN05 e RN08). */
  async unreadCountPlanner({ userId }: { userId: string }): Promise<number> {
    await requirePlannerProfile({ profiles: this.profiles, userId });
    return this.store.unreadCountPlanner({ userId });
  }

  /** Marcar todas como lidas na central dela não marca as do casal (RN05). */
  async readAllPlanner({ userId, now }: { userId: string; now: Date }): Promise<void> {
    await requirePlannerProfile({ profiles: this.profiles, userId });
    await this.store.markAllReadPlanner({ userId, now });
  }

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
    private readonly config: AppConfigService,
    @Inject(PLANNER_PROFILES) private readonly profiles: PlannerProfiles,
  ) {}

  /**
   * A preferência geral da cerimonialista (Notificações da cerimonialista RN06),
   * sem casamento, para os 3 tipos; sem linha, o padrão.
   */
  async getGeneral({
    userId,
    sessionId,
  }: {
    userId: string;
    sessionId: string;
  }): Promise<PreferencesView> {
    await requirePlannerProfile({ profiles: this.profiles, userId });
    const saved = new Map(
      (await this.store.generalPreferences({ userId })).map((row) => [row.type, row]),
    );
    return {
      items: PLANNER_NOTIFICATION_TYPES.map(
        (type) => saved.get(type) ?? { type, ...DEFAULT_PREFERENCE },
      ),
      push: {
        subscribed: await this.store.hasPushSubscription({ sessionId }),
        vapidPublicKey: this.config.get({ key: 'VAPID_PUBLIC_KEY' }) ?? null,
      },
    };
  }

  async saveGeneralEmail({
    userId,
    type,
    email,
  }: {
    userId: string;
    type: PlannerNotificationType;
    email: EmailFrequency;
  }): Promise<PreferenceRow> {
    await requirePlannerProfile({ profiles: this.profiles, userId });
    return this.store.saveGeneralEmailPreference({ userId, type, email });
  }

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
        // Pela API, sem variável de build (R8-6); nula com o push desligado no ambiente.
        vapidPublicKey: this.config.get({ key: 'VAPID_PUBLIC_KEY' }) ?? null,
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
