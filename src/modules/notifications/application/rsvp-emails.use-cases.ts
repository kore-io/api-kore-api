import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import {
  EMAIL_SENDER,
  type EmailSender,
} from '../../../shared/email/application/email-sender.port';
import { localDate } from '../../../shared/time/local-date';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import {
  DIGEST_HOUR,
  IMMEDIATE_WINDOW_MS,
  digestEmail,
  immediateEmail,
  localHour,
  newestAt,
  pendingGroups,
  type EmailContext,
} from '../infrastructure/emails/notification-email';
import {
  NOTIFICATION_EMAIL_STORE,
  type LockedEmailState,
  type NotificationEmailStore,
} from './ports/notification-email-store.port';

const logger = new Logger('RsvpEmails');

/** O caminho da tela Configurações › Notificações no app (o link direto do rodapé, R8-9). */
export const NOTIFICATION_SETTINGS_PATH = '/app/configuracoes/notificacoes';

/**
 * Como o e-mail sai: `immediate` é o job do "Na hora"; `catch_up` é a rede de
 * segurança da rotina de 15 minutos para o "Na hora" que se perdeu; `digest`
 * é o Resumo diário às 20h no fuso do casamento.
 */
export type EmailMode = 'immediate' | 'catch_up' | 'digest';

export type SendResult = { kind: 'sent' } | { kind: 'skipped' } | { kind: 'later'; at: Date };

/**
 * Os e-mails das respostas (E-mail e push RN01 a RN06 e RN09), do lado do
 * worker. Na hora de mandar, confere de novo o vínculo e a preferência. O
 * e-mail leva os grupos com `at > emailedThrough`, e o cursor avança só
 * depois de o servidor de e-mail aceitar, na mesma transação do estado.
 */
@Injectable()
export class RsvpEmails {
  private readonly appUrl: string;

  constructor(
    @Inject(NOTIFICATION_EMAIL_STORE) private readonly store: NotificationEmailStore,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
    config: AppConfigService,
  ) {
    this.appUrl = config.get({ key: 'APP_URL' }).replace(/\/+$/, '');
  }

  /**
   * Quando a notificação nasce ou soma (RN03): para quem está em "Na hora",
   * agora se o último foi há mais de 15 minutos (ou nunca); senão, 15 minutos
   * depois do último. Nulo: a pessoa não está em "Na hora".
   */
  async immediateAt({
    userId,
    weddingId,
    now,
  }: {
    userId: string;
    weddingId: string;
    now: Date;
  }): Promise<Date | null> {
    const { frequency, lastImmediateAt } = await this.store.peek({ userId, weddingId });
    if (frequency !== 'immediate') return null;
    const next = lastImmediateAt ? lastImmediateAt.getTime() + IMMEDIATE_WINDOW_MS : 0;
    return new Date(Math.max(now.getTime(), next));
  }

  async send({
    userId,
    weddingId,
    mode,
    now,
  }: {
    userId: string;
    weddingId: string;
    mode: EmailMode;
    now: Date;
  }): Promise<SendResult> {
    let result: SendResult = { kind: 'skipped' };
    await this.store.withLockedState({
      userId,
      weddingId,
      work: async (state) => {
        if (!state.member) return null;
        const groups = pendingGroups({
          payloads: state.payloads,
          emailedThrough: state.emailedThrough,
        });
        if (groups.length === 0) return null;
        const context: EmailContext = {
          to: state.email,
          firstName: state.firstName,
          groups,
          totals: state.totals,
          guestsUrl: `${this.appUrl}/app/convidados`,
          settingsUrl: `${this.appUrl}${NOTIFICATION_SETTINGS_PATH}`,
        };
        if (mode === 'digest') {
          const today = localDate({ at: now, timezone: state.timezone });
          if (
            state.frequency !== 'daily' ||
            localHour({ at: now, timezone: state.timezone }) < DIGEST_HOUR ||
            state.lastDigestDate === today
          )
            return null;
          await this.sender.send({ message: digestEmail({ context }) });
          result = { kind: 'sent' };
          return { emailedThrough: newestAt({ groups }), lastDigestDate: today };
        }
        if (state.frequency !== 'immediate') return null;
        const later = this.notBefore({ state, now });
        if (later) {
          result = { kind: 'later', at: later };
          return null;
        }
        // A rede de segurança só manda o que esperou mais de 15 minutos.
        if (mode === 'catch_up' && Date.parse(groups[0].at) > now.getTime() - IMMEDIATE_WINDOW_MS)
          return null;
        await this.sender.send({ message: immediateEmail({ context }) });
        result = { kind: 'sent' };
        return { emailedThrough: newestAt({ groups }), lastImmediateAt: now };
      },
    });
    return result;
  }

  /**
   * A rotina de 15 minutos (RN04): o Resumo diário de quem passou das 20h e a
   * rede de segurança do "Na hora". A falha de um envio fica no log e não para
   * os outros; o próximo envio leva o que faltou.
   */
  async sweep({ now }: { now: Date }): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;
    for (const { userId, weddingId } of await this.store.candidates()) {
      for (const mode of ['digest', 'catch_up'] as const) {
        try {
          if ((await this.send({ userId, weddingId, mode, now })).kind === 'sent') sent++;
        } catch (error) {
          failed++;
          logger.warn(`E-mail de respostas falhou (${(error as Error).name}).`);
          await this.recordFailure({ userId, weddingId });
        }
      }
    }
    return { sent, failed };
  }

  /** Depois das tentativas: o log só com ids (RN06); o cursor não avançou. */
  async recordFailure({ userId, weddingId }: { userId: string; weddingId: string }): Promise<void> {
    await this.log.record({
      entry: {
        action: 'notification.email_failed',
        actorKind: 'system',
        weddingId,
        entityType: 'user',
        entityId: userId,
      },
    });
  }

  private notBefore({ state, now }: { state: LockedEmailState; now: Date }): Date | null {
    if (!state.lastImmediateAt) return null;
    const next = state.lastImmediateAt.getTime() + IMMEDIATE_WINDOW_MS;
    return next > now.getTime() ? new Date(next) : null;
  }
}
