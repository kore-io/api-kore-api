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
  localHour,
  newestAt,
  pendingGroups,
  plannerDigestEmail,
  type PlannerDigestBlock,
} from '../infrastructure/emails/notification-email';
import {
  PLANNER_DIGEST_STORE,
  type PlannerDigestChange,
  type PlannerDigestStore,
} from './ports/planner-digest-store.port';
import { PLANNER_NOTIFICATION_SETTINGS_PATH } from './rsvp-emails.use-cases';

const logger = new Logger('PlannerDigest');

/**
 * O Resumo agrupado da cerimonialista sai às 20h no fuso fixo de São Paulo,
 * para toda cerimonialista (decisão 224(5)).
 */
export const PLANNER_DIGEST_TIMEZONE = 'America/Sao_Paulo';

/**
 * O Resumo diário agrupado (Notificações da cerimonialista RN07; decisão 223,
 * D18; decisão 224(5)): um e-mail por pessoa por dia, com um bloco por
 * casamento. Respostas pela preferência geral do `rsvp` e publicações pela do
 * `wedding_published`, as duas em Resumo diário. O vínculo é conferido de novo
 * na hora (D18).
 */
@Injectable()
export class PlannerDigest {
  private readonly appUrl: string;

  constructor(
    @Inject(PLANNER_DIGEST_STORE) private readonly store: PlannerDigestStore,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
    config: AppConfigService,
  ) {
    this.appUrl = config.get({ key: 'APP_URL' }).replace(/\/+$/, '');
  }

  async send({ userId, now }: { userId: string; now: Date }): Promise<boolean> {
    let sent = false;
    const today = localDate({ at: now, timezone: PLANNER_DIGEST_TIMEZONE });
    await this.store.withLockedDigest({
      userId,
      work: async (state): Promise<PlannerDigestChange | null> => {
        if (state.lastDigestDate === today) return null;
        const blocks: PlannerDigestBlock[] = [];
        const cursors: PlannerDigestChange['cursors'] = [];
        for (const wedding of state.weddings) {
          const groups =
            state.rsvpFrequency === 'daily'
              ? pendingGroups({
                  payloads: wedding.rsvpPayloads,
                  emailedThrough: wedding.emailedThrough,
                })
              : [];
          const published = state.publishedFrequency === 'daily' && wedding.publishedAt !== null;
          if (groups.length === 0 && !published) continue;
          blocks.push({
            partnerNames: wedding.partnerNames,
            groupCount: groups.length,
            published,
          });
          const newest = Math.max(
            groups.length ? newestAt({ groups }).getTime() : 0,
            published && wedding.publishedAt ? wedding.publishedAt.getTime() : 0,
          );
          cursors.push({ weddingId: wedding.weddingId, emailedThrough: new Date(newest) });
        }
        if (blocks.length === 0) return null;
        await this.sender.send({
          message: plannerDigestEmail({
            to: state.email,
            firstName: state.firstName,
            blocks,
            homeUrl: `${this.appUrl}/cerimonialista`,
            settingsUrl: `${this.appUrl}${PLANNER_NOTIFICATION_SETTINGS_PATH}`,
          }),
        });
        sent = true;
        return { lastDigestDate: today, cursors };
      },
    });
    return sent;
  }

  /** Na rotina de 15 minutos: a partir das 20h de São Paulo, uma vez por dia por pessoa. */
  async sweep({ now }: { now: Date }): Promise<{ sent: number; failed: number }> {
    if (localHour({ at: now, timezone: PLANNER_DIGEST_TIMEZONE }) < DIGEST_HOUR)
      return { sent: 0, failed: 0 };
    let sent = 0;
    let failed = 0;
    for (const userId of await this.store.candidates()) {
      try {
        if (await this.send({ userId, now })) sent++;
      } catch (error) {
        failed++;
        logger.warn(`Resumo agrupado falhou (${(error as Error).name}).`);
        // O log só com ids (E-mail e push RN06); o cursor não avançou.
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
    return { sent, failed };
  }
}
