import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import {
  EMAIL_SENDER,
  type EmailSender,
} from '../../../shared/email/application/email-sender.port';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import {
  commissionAvailableEmail,
  DIGEST_HOUR,
  localHour,
} from '../infrastructure/emails/notification-email';
import {
  COMMISSION_EMAIL_STORE,
  type CommissionEmailStore,
} from './ports/commission-email-store.port';
import { PLANNER_DIGEST_TIMEZONE } from './planner-digest.use-case';
import {
  PLANNER_COMMISSIONS_PATH,
  PLANNER_NOTIFICATION_SETTINGS_PATH,
} from './rsvp-emails.use-cases';

const logger = new Logger('CommissionEmails');

/**
 * O e-mail "Você tem comissão disponível" (Comissões do indicador RN09;
 * decisão 242), pela preferência geral `commission`: Na hora, um por rodada
 * da liberação (3h30); Resumo diário (o padrão), um às 20h de São Paulo se
 * alguma comissão ficou disponível desde o último; Desligado, nenhum. O
 * cursor é o mesmo nos dois modos: trocar de um para o outro não repete.
 */
@Injectable()
export class CommissionEmails {
  private readonly appUrl: string;

  constructor(
    @Inject(COMMISSION_EMAIL_STORE) private readonly store: CommissionEmailStore,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
    config: AppConfigService,
  ) {
    this.appUrl = config.get({ key: 'APP_URL' }).replace(/\/+$/, '');
  }

  async send({ userId, mode }: { userId: string; mode: 'immediate' | 'daily' }): Promise<boolean> {
    let sent = false;
    await this.store.withLockedState({
      userId,
      work: async (state) => {
        if (state.frequency !== mode || state.newestPendingAt === null) return null;
        await this.sender.send({
          message: commissionAvailableEmail({
            to: state.email,
            firstName: state.firstName,
            mode,
            commissionsUrl: `${this.appUrl}${PLANNER_COMMISSIONS_PATH}`,
            settingsUrl: `${this.appUrl}${PLANNER_NOTIFICATION_SETTINGS_PATH}`,
          }),
        });
        sent = true;
        return state.newestPendingAt;
      },
    });
    return sent;
  }

  /** Na rotina de 15 minutos: a partir das 20h de São Paulo, o Resumo diário. */
  async sweep({ now }: { now: Date }): Promise<{ sent: number; failed: number }> {
    if (localHour({ at: now, timezone: PLANNER_DIGEST_TIMEZONE }) < DIGEST_HOUR)
      return { sent: 0, failed: 0 };
    let sent = 0;
    let failed = 0;
    for (const userId of await this.store.dailyCandidates()) {
      try {
        if (await this.send({ userId, mode: 'daily' })) sent++;
      } catch (error) {
        failed++;
        await this.recordFailure({ userId, error });
      }
    }
    return { sent, failed };
  }

  /** O log só com ids (E-mail e push RN06); o cursor não avançou. */
  async recordFailure({ userId, error }: { userId: string; error?: unknown }): Promise<void> {
    logger.warn(`E-mail de comissão falhou (${(error as Error | undefined)?.name ?? '?'}).`);
    await this.log.record({
      entry: {
        action: 'notification.email_failed',
        actorKind: 'system',
        entityType: 'user',
        entityId: userId,
      },
    });
  }
}
